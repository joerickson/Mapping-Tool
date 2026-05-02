// POST /api/scheduler/cycles/[cycleId]/rebalance-suggestions
//
// Three remediation types after a cycle generates:
//
//   property_move   — re-route an unplaced cluster to a recipient crew
//                     with idle capacity (existing behavior, looser
//                     filters, allows partial absorption).
//   crew_relocate   — a severely-idle crew's home branch has no nearby
//                     work; restage them at a branch with unserved demand.
//                     Updates crew_count_per_branch_override (-1 origin,
//                     +1 target).
//   crew_reduce     — no relocation helps (geography won't); reducing
//                     crew_count saves labor cost. -1 from the most-idle
//                     branch.
//
// Optional Claude advisor pass (if X-Advise: true on the request) takes
// the heuristic candidates plus cycle context and returns a ranked
// narrative recommendation explaining trade-offs.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import { haversineMiles } from '../../../_lib/analysis/haversine.js'

export const config = { maxDuration: 60 }

const ADVISOR_MODEL = 'claude-sonnet-4-5'
const ADVISOR_MAX_TOKENS = 1200
// A crew below this utilization fraction is severely-idle; relocation /
// reduction suggestions get generated for it.
const SEVERELY_IDLE_THRESHOLD = 0.4

type SuggestionType = 'property_move' | 'crew_relocate' | 'crew_reduce'

interface BaseSuggestion {
  id: string
  type: SuggestionType
  title: string
  summary: string
  priority: number // higher = more impact
}

interface PropertyMoveSuggestion extends BaseSuggestion {
  type: 'property_move'
  from_branch_idx: number
  from_branch_name: string
  to_branch_idx: number
  to_branch_name: string
  property_count: number
  service_location_ids: string[]
  property_ids: string[]
  cluster_label: string
  drive_delta_miles: number
}

interface CrewRelocateSuggestion extends BaseSuggestion {
  type: 'crew_relocate'
  crew_index: number
  crew_label: string
  from_branch_name: string
  to_branch_name: string
  idle_days_freed: number
  expected_absorbed_count: number
}

interface CrewReduceSuggestion extends BaseSuggestion {
  type: 'crew_reduce'
  branch_name: string
  current_count: number
  proposed_count: number
  idle_days_freed: number
}

type Suggestion = PropertyMoveSuggestion | CrewRelocateSuggestion | CrewReduceSuggestion

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try { await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const cycleId = req.query.cycleId as string
  if (!cycleId) return res.status(400).json({ error: 'cycleId required' })
  const wantAdvisor = String(req.headers['x-advise'] ?? '').toLowerCase() === 'true'
  const db = createAdminClient()

  // ── Load cycle, template, visits, routes ──────────────────────────
  const { data: cycle } = await db
    .from('cycle_instances')
    .select('*')
    .eq('id', cycleId)
    .maybeSingle()
  if (!cycle) return res.status(404).json({ error: 'Cycle not found' })

  let template: any = null
  if (cycle.template_id) {
    const { data } = await db
      .from('routing_templates')
      .select('*')
      .eq('id', cycle.template_id)
      .maybeSingle()
    template = data
  }
  if (!template) return res.status(404).json({ error: 'Template not found' })

  const PAGE = 1000
  const visits: any[] = []
  for (let p = 0; p < 50; p++) {
    const { data } = await db
      .from('scheduled_visits')
      .select('id, status, service_location_id, property_id, scheduled_date, unplaced_reason, hours_per_visit_total, service_locations(property:properties(id, latitude, longitude, address_line1))')
      .eq('cycle_instance_id', cycleId)
      .range(p * PAGE, (p + 1) * PAGE - 1)
    const batch = data ?? []
    visits.push(...batch)
    if (batch.length < PAGE) break
  }
  const crewDays: any[] = []
  for (let p = 0; p < 50; p++) {
    const { data } = await db
      .from('crew_day_routes')
      .select('id, crew_index, crew_label, scheduled_date, day_type, route, start_location')
      .eq('cycle_instance_id', cycleId)
      .range(p * PAGE, (p + 1) * PAGE - 1)
    const batch = data ?? []
    crewDays.push(...batch)
    if (batch.length < PAGE) break
  }

  const branches = (template.branches ?? []) as Array<{ name: string; lat: number; lng: number }>
  const cfg = (template.config ?? {}) as Record<string, any>
  const clusterRadius = (cfg.cluster_radius_miles as number) ?? 30
  const crewCount = (template.crew_count as number) ?? 0
  const crewAssignments = (template.crew_assignments ?? []) as Array<{
    index?: number
    label?: string
    home_branch_index?: number
  }>

  // crew_index → home branch (template snapshot). Falls back to
  // start_location coords matched against branches.
  const crewBranch = new Map<number, { idx: number; name: string; lat: number; lng: number; label: string }>()
  for (const ca of crewAssignments) {
    const idx = typeof ca.index === 'number' ? ca.index : null
    const home = typeof ca.home_branch_index === 'number' ? ca.home_branch_index : null
    if (idx == null || home == null) continue
    const b = branches[home]
    if (!b) continue
    crewBranch.set(idx, {
      idx: home,
      name: b.name,
      lat: b.lat,
      lng: b.lng,
      label: ca.label ?? `Crew ${idx + 1}`,
    })
  }
  // Fallback for any crew without a template assignment row.
  for (let i = 0; i < crewCount; i++) {
    if (crewBranch.has(i)) continue
    const cd = crewDays.find((d: any) => d.crew_index === i)
    const sl = cd?.start_location
    if (sl && typeof sl.lat === 'number' && typeof sl.lng === 'number') {
      let bestIdx = 0
      let best = Number.POSITIVE_INFINITY
      for (let j = 0; j < branches.length; j++) {
        const d = haversineMiles({ lat: sl.lat, lng: sl.lng }, branches[j])
        if (d < best) { best = d; bestIdx = j }
      }
      crewBranch.set(i, {
        idx: bestIdx,
        name: sl.name ?? branches[bestIdx]?.name ?? `Crew ${i + 1}`,
        lat: sl.lat,
        lng: sl.lng,
        label: cd?.crew_label ?? `Crew ${i + 1}`,
      })
    } else {
      const b = branches[i % Math.max(1, branches.length)]
      if (b) {
        crewBranch.set(i, {
          idx: i % branches.length,
          name: b.name,
          lat: b.lat,
          lng: b.lng,
          label: cd?.crew_label ?? `Crew ${i + 1}`,
        })
      }
    }
  }

  // Workday calendar + per-crew busy/idle counts.
  const cycleStart = new Date(`${cycle.start_date}T00:00:00Z`)
  const cycleEnd = new Date(`${cycle.end_date}T00:00:00Z`)
  const workdays: string[] = []
  for (let d = new Date(cycleStart); d <= cycleEnd; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) workdays.push(d.toISOString().slice(0, 10))
  }
  const usedByCrew = new Map<number, Set<string>>()
  for (const cd of crewDays) {
    const set = usedByCrew.get(cd.crew_index) ?? new Set<string>()
    set.add(cd.scheduled_date)
    usedByCrew.set(cd.crew_index, set)
  }
  const idleByCrew = new Map<number, number>()
  const busyByCrew = new Map<number, number>()
  for (const idx of crewBranch.keys()) {
    const used = usedByCrew.get(idx) ?? new Set()
    const idle = workdays.filter((d) => !used.has(d)).length
    idleByCrew.set(idx, idle)
    busyByCrew.set(idx, workdays.length - idle)
  }
  // Idle days per branch (sum over crews homed there).
  const idleByBranch = new Map<number, number>()
  for (const [crewIdx, b] of crewBranch.entries()) {
    idleByBranch.set(b.idx, (idleByBranch.get(b.idx) ?? 0) + (idleByCrew.get(crewIdx) ?? 0))
  }
  // Crews per branch.
  const crewsByBranch = new Map<number, number>()
  for (const b of crewBranch.values()) {
    crewsByBranch.set(b.idx, (crewsByBranch.get(b.idx) ?? 0) + 1)
  }

  const unplaced = visits.filter((v) => v.status === 'unplaced')

  // Group unplaced by parsed cluster_label.
  const groups = new Map<string, { label: string; props: any[] }>()
  for (const u of unplaced) {
    const reason: string = u.unplaced_reason ?? ''
    let label = 'Unknown'
    const m1 = reason.match(/cluster\s+([^()]+?)(?:\s+\()/)
    const m2 = reason.match(/Trip\s+"([^"]+)"/)
    if (m1) label = m1[1].trim()
    else if (m2) label = m2[1].trim()
    const g = groups.get(label) ?? { label, props: [] }
    g.props.push(u)
    groups.set(label, g)
  }

  const overrides = (template.branch_assignment_overrides ?? {}) as Record<string, number>
  const suggestions: Suggestion[] = []
  let suggestionId = 1

  // ── 1. Property-move suggestions (looser filters than v1) ─────────
  for (const [label, group] of groups) {
    const validProps = group.props.filter(
      (u) =>
        typeof u.service_locations?.property?.latitude === 'number' &&
        typeof u.service_locations?.property?.longitude === 'number'
    )
    if (validProps.length === 0) continue

    const centroidLat =
      validProps.reduce((s, u) => s + u.service_locations.property.latitude, 0) / validProps.length
    const centroidLng =
      validProps.reduce((s, u) => s + u.service_locations.property.longitude, 0) / validProps.length

    let fromBranchIdx = 0
    let fromDist = Number.POSITIVE_INFINITY
    for (const b of crewBranch.values()) {
      const d = haversineMiles({ lat: centroidLat, lng: centroidLng }, b)
      if (d < fromDist) { fromDist = d; fromBranchIdx = b.idx }
    }

    // Allow PARTIAL absorption — recipient just needs SOME idle capacity.
    // Distance cap loosened to 4× cluster radius (combined-client
    // portfolios span large geographies; 2× was too tight).
    const candidates = Array.from(crewBranch.values())
      .filter((b) => b.idx !== fromBranchIdx)
      .map((b) => {
        const idleSum = Array.from(crewBranch.entries())
          .filter(([, bb]) => bb.idx === b.idx)
          .reduce((s, [crewIdx]) => s + (idleByCrew.get(crewIdx) ?? 0), 0)
        return {
          b,
          dist: haversineMiles({ lat: centroidLat, lng: centroidLng }, b),
          idle: idleSum,
        }
      })
      .filter((c) => c.idle > 0)
      .filter((c) => c.dist <= clusterRadius * 4)
      .sort((a, c) => {
        if (c.idle === a.idle) return a.dist - c.dist
        return c.idle - a.idle
      })

    if (candidates.length === 0) continue
    const best = candidates[0]
    const absorbCount = Math.min(validProps.length, best.idle)
    const absorbed = validProps.slice(0, absorbCount)

    suggestions.push({
      id: `pm-${suggestionId++}`,
      type: 'property_move',
      priority: 100 + absorbed.length,
      title: `Move ${absorbed.length} of ${validProps.length} ${label} → ${best.b.name}`,
      summary:
        `${absorbed.length} unplaced ${label} propert${absorbed.length === 1 ? 'y' : 'ies'} ` +
        `currently routed via ${branches[fromBranchIdx]?.name ?? 'origin'}. ` +
        `${best.b.name} has ${best.idle} idle workday${best.idle === 1 ? '' : 's'} and is ` +
        `${Math.round(best.dist)}mi from the cluster (vs ${Math.round(fromDist)}mi from ` +
        `${branches[fromBranchIdx]?.name ?? 'origin'}).` +
        (validProps.length > absorbCount
          ? ` ${validProps.length - absorbCount} would still need a separate solution.`
          : ''),
      from_branch_idx: fromBranchIdx,
      from_branch_name: branches[fromBranchIdx]?.name ?? `Branch ${fromBranchIdx}`,
      to_branch_idx: best.b.idx,
      to_branch_name: best.b.name,
      property_count: absorbed.length,
      service_location_ids: absorbed.map((u) => u.service_location_id),
      property_ids: absorbed.map((u) => u.property_id),
      cluster_label: label,
      drive_delta_miles: Math.round(best.dist - fromDist),
    })
  }

  // ── 2. Crew relocation — severely-idle crew → branch w/ unserved demand ─
  for (const [crewIdx, home] of crewBranch.entries()) {
    const total = workdays.length
    const idle = idleByCrew.get(crewIdx) ?? 0
    const utilization = total > 0 ? (total - idle) / total : 0
    if (utilization >= SEVERELY_IDLE_THRESHOLD) continue

    // Find the branch with the most "unserved demand" defined as either:
    //   (a) sum of nearby unplaced visits, or
    //   (b) high idle-days / property-count ratio (saturated)
    // Skip branches the crew is already homed at.
    type BranchScore = { branchIdx: number; branchName: string; score: number; reason: string }
    const scores: BranchScore[] = []
    for (let bi = 0; bi < branches.length; bi++) {
      if (bi === home.idx) continue
      const b = branches[bi]
      // Unplaced visits within 2× cluster radius of this branch.
      let nearby = 0
      for (const u of unplaced) {
        const lat = u.service_locations?.property?.latitude
        const lng = u.service_locations?.property?.longitude
        if (typeof lat !== 'number' || typeof lng !== 'number') continue
        const d = haversineMiles({ lat, lng }, b)
        if (d <= clusterRadius * 2) nearby++
      }
      if (nearby > 0) {
        scores.push({
          branchIdx: bi,
          branchName: b.name,
          score: nearby,
          reason: `${nearby} unplaced visit${nearby === 1 ? '' : 's'} within ${Math.round(clusterRadius * 2)}mi of ${b.name}`,
        })
      }
    }
    scores.sort((a, b) => b.score - a.score)
    if (scores.length === 0) continue
    const target = scores[0]

    suggestions.push({
      id: `cr-${suggestionId++}`,
      type: 'crew_relocate',
      priority: 200 + idle, // higher than property-moves
      title: `Restage ${home.label} from ${home.name} → ${target.branchName}`,
      summary:
        `${home.label} is ${Math.round(utilization * 100)}% utilized at ${home.name} ` +
        `(${idle} idle workdays). ${target.reason} — restaging this crew there ` +
        `would free their idle capacity for absorbable work.`,
      crew_index: crewIdx,
      crew_label: home.label,
      from_branch_name: home.name,
      to_branch_name: target.branchName,
      idle_days_freed: idle,
      expected_absorbed_count: target.score,
    })
  }

  // ── 3. Crew reduction — branch is overstaffed and no relocation helps ─
  // Trigger when a branch's idle-days > cycle-length × 0.6 per crew there
  // AND we haven't already proposed relocating any crew from that branch.
  const hasRelocateFrom = new Set(
    suggestions
      .filter((s): s is CrewRelocateSuggestion => s.type === 'crew_relocate')
      .map((s) => s.from_branch_name)
  )
  for (const [branchIdx, idleDays] of idleByBranch.entries()) {
    const branchName = branches[branchIdx]?.name
    if (!branchName) continue
    if (hasRelocateFrom.has(branchName)) continue
    const crews = crewsByBranch.get(branchIdx) ?? 0
    if (crews <= 1) continue
    const idlePerCrew = idleDays / crews
    if (idlePerCrew >= workdays.length * 0.6) {
      suggestions.push({
        id: `cd-${suggestionId++}`,
        type: 'crew_reduce',
        priority: 150 + Math.round(idleDays / 10),
        title: `Reduce crews at ${branchName}: ${crews} → ${crews - 1}`,
        summary:
          `${branchName} has ${crews} crews averaging ${Math.round(idlePerCrew)} idle workdays ` +
          `each (${Math.round((idlePerCrew / workdays.length) * 100)}% idle). ` +
          `Removing one crew saves the FTE labor cost without dropping any placed work.`,
        branch_name: branchName,
        current_count: crews,
        proposed_count: crews - 1,
        idle_days_freed: Math.round(idlePerCrew),
      })
    }
  }

  // Skip property-moves the operator already overrode.
  let filtered = suggestions
  if (Object.keys(overrides).length > 0) {
    filtered = suggestions.filter((s) => {
      if (s.type !== 'property_move') return true
      return s.service_location_ids.some((sl) => overrides[sl] !== s.to_branch_idx)
    })
  }

  // Cross-check crew_relocate / crew_reduce against the LIVE constraints.
  // Earlier Applies in this session patch crew_count_per_branch_override
  // before the user regenerates — the cycle still shows the old staging,
  // so without this check we'd offer stale suggestions like "relocate a
  // crew from Lindon" after Lindon's count was already zeroed.
  const { data: conRow } = await db
    .from('account_operational_constraints')
    .select('crew_count_per_branch_override')
    .eq('account_id', (template as any).account_id)
    .eq('client_id', (template as any).client_id)
    .maybeSingle()
  const liveStaging: Record<string, number> = {}
  const overrideSrc = ((conRow as any)?.crew_count_per_branch_override ?? null) as
    | Record<string, number>
    | null
  if (overrideSrc) {
    for (const [k, v] of Object.entries(overrideSrc)) {
      if (k === '__roving') continue
      const n = Math.floor(Number(v) || 0)
      if (n > 0) liveStaging[k] = n
    }
  }
  // Lookup is case-insensitive on branch names.
  const liveLookup = (name: string): number => {
    if (Object.keys(liveStaging).length === 0) return Number.POSITIVE_INFINITY
    if (liveStaging[name] != null) return liveStaging[name]
    const ci = Object.entries(liveStaging).find(
      ([k]) => k.toLowerCase() === name.toLowerCase()
    )
    return ci ? ci[1] : 0
  }
  const beforeFilter = filtered.length
  filtered = filtered.filter((s) => {
    if (s.type === 'crew_relocate') return liveLookup(s.from_branch_name) >= 1
    if (s.type === 'crew_reduce') return liveLookup(s.branch_name) >= 2
    return true
  })
  const stalenessSkipped = beforeFilter - filtered.length

  filtered.sort((a, b) => b.priority - a.priority)

  // ── 4. Optional Claude advisor on top ─────────────────────────────
  let advisor: { recommendation: string; ranked_actions: string[] } | null = null
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (wantAdvisor && apiKey && filtered.length > 0) {
    try {
      const anthropic = new Anthropic({ apiKey })
      const ctx = {
        cycle: {
          start: cycle.start_date,
          end: cycle.end_date,
          workdays: workdays.length,
          crew_count: crewCount,
          unplaced_count: unplaced.length,
          total_idle_days: Array.from(idleByCrew.values()).reduce((s, n) => s + n, 0),
        },
        branches: branches.map((b, i) => ({
          name: b.name,
          crews_homed: crewsByBranch.get(i) ?? 0,
          idle_days: idleByBranch.get(i) ?? 0,
        })),
        crews_critical: Array.from(crewBranch.entries())
          .map(([idx, b]) => ({
            label: b.label,
            home: b.name,
            idle: idleByCrew.get(idx) ?? 0,
            busy: busyByCrew.get(idx) ?? 0,
            utilization_pct: workdays.length > 0
              ? Math.round(((busyByCrew.get(idx) ?? 0) / workdays.length) * 100)
              : 0,
          }))
          .filter((c) => c.utilization_pct < 40)
          .slice(0, 10),
        suggestions: filtered.map((s) => ({
          id: s.id,
          type: s.type,
          title: s.title,
          summary: s.summary,
          priority: s.priority,
        })),
      }

      const systemPrompt =
        `You are an operations analyst reviewing a routing-template cycle. The deterministic engine has produced a list of remediation suggestions. Your job: synthesize a concise recommended-actions narrative that:
1. Names the highest-leverage move(s) — usually 1-3 actions.
2. Explains WHY (cite specific numbers from the context).
3. Notes trade-offs the engine can't see (e.g. dropping a crew has labor savings but capacity loss; relocation incurs setup cost).
4. Lists a ranked sequence of suggestion IDs the operator should apply.

Output format — JSON only, no prose around it:
{
  "recommendation": "short paragraph (≤4 sentences) describing the recommended path forward",
  "ranked_actions": ["sug-id-1", "sug-id-2", ...]
}

Be terse. The operator scans, doesn't read.`

      const userMsg = `Cycle context:\n${JSON.stringify(ctx, null, 2)}`
      const resp = await anthropic.messages.create({
        model: ADVISOR_MODEL,
        max_tokens: ADVISOR_MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }],
      })
      const text = resp.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('')
      // Extract first JSON object.
      const m = text.match(/\{[\s\S]*\}/)
      if (m) {
        try {
          const parsed = JSON.parse(m[0])
          if (typeof parsed.recommendation === 'string' && Array.isArray(parsed.ranked_actions)) {
            advisor = {
              recommendation: parsed.recommendation,
              ranked_actions: parsed.ranked_actions.filter((s: any) => typeof s === 'string'),
            }
          }
        } catch {
          // ignore parse failure — advisor stays null
        }
      }
    } catch {
      // Advisor failures must never break the deterministic suggestions.
    }
  }

  return res.status(200).json({
    suggestions: filtered,
    advisor,
    stale_skipped: stalenessSkipped,
    needs_regenerate: stalenessSkipped > 0,
  })
}
