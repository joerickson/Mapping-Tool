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

type SuggestionType = 'property_move' | 'staging_rebalance'

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

// Single global re-staging proposal. Replaces the previous per-crew
// crew_relocate / crew_reduce suggestions, which oscillated: each
// individual move locally optimized but globally swung the system to
// the opposite imbalance (Lindon→Vegas → Vegas→Lindon → Lindon→Phoenix
// → loop forever). This proposes the entire optimal distribution
// computed from where the cycle actually placed work, applied in one
// shot. One PATCH, one regenerate, converged.
interface StagingRebalanceSuggestion extends BaseSuggestion {
  type: 'staging_rebalance'
  current_per_branch: Record<string, number>
  proposed_per_branch: Record<string, number>
  delta_summary: Array<{ branch_name: string; from: number; to: number; change: number }>
  total_crews: number
}

type Suggestion = PropertyMoveSuggestion | StagingRebalanceSuggestion

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
  // Persisted with crew_-prefixed keys. home_branch_index has been
  // emitted since the audit fix; older templates fall through to the
  // start_location fallback below.
  const crewAssignments = (template.crew_assignments ?? []) as Array<{
    crew_index?: number
    crew_label?: string
    home_branch_index?: number
    home_branch_name?: string
  }>

  // crew_index → home branch (template snapshot). Always rebuild the
  // human label from the home branch — even legacy templates with
  // unprefixed "Crew N" labels get clean "Lindon Crew 1" style names
  // here without requiring a regenerate.
  const crewBranch = new Map<number, { idx: number; name: string; lat: number; lng: number; label: string }>()
  // First pass: bucket crews by home_branch_index so the per-branch
  // counter is sequential (Lindon Crew 1, Lindon Crew 2, etc.).
  const branchCounters = new Map<number, number>()
  // Walk in crew-index order so numbering is stable.
  const sortedAssignments = [...crewAssignments].sort((a, b) => {
    const ai = typeof a.crew_index === 'number' ? a.crew_index : 0
    const bi = typeof b.crew_index === 'number' ? b.crew_index : 0
    return ai - bi
  })
  for (const ca of sortedAssignments) {
    const idx = typeof ca.crew_index === 'number' ? ca.crew_index : null
    const home = typeof ca.home_branch_index === 'number' ? ca.home_branch_index : null
    if (idx == null || home == null) continue
    const b = branches[home]
    if (!b) continue
    const counter = (branchCounters.get(home) ?? 0) + 1
    branchCounters.set(home, counter)
    // Empty / whitespace-only branch names fall back to "Branch N".
    const branchName = (b.name ?? '').trim() || `Branch ${home + 1}`
    crewBranch.set(idx, {
      idx: home,
      name: branchName,
      lat: b.lat,
      lng: b.lng,
      label: `${branchName} Crew ${counter}`,
    })
  }
  // Fallback for any crew without a template assignment row.
  // Resolve a home branch from start_location coords (or modulo as a
  // last resort) and ALWAYS build a branch-prefixed label.
  for (let i = 0; i < crewCount; i++) {
    if (crewBranch.has(i)) continue
    const cd = crewDays.find((d: any) => d.crew_index === i)
    const sl = cd?.start_location
    let resolvedIdx: number
    let resolvedBranch: { name: string; lat: number; lng: number }
    if (sl && typeof sl.lat === 'number' && typeof sl.lng === 'number') {
      let bestIdx = 0
      let best = Number.POSITIVE_INFINITY
      for (let j = 0; j < branches.length; j++) {
        const d = haversineMiles({ lat: sl.lat, lng: sl.lng }, branches[j])
        if (d < best) { best = d; bestIdx = j }
      }
      resolvedIdx = bestIdx
      resolvedBranch = branches[bestIdx] ?? { name: sl.name ?? `Branch ${bestIdx + 1}`, lat: sl.lat, lng: sl.lng }
    } else {
      const fallbackIdx = i % Math.max(1, branches.length)
      const b = branches[fallbackIdx]
      if (!b) continue
      resolvedIdx = fallbackIdx
      resolvedBranch = b
    }
    const counter = (branchCounters.get(resolvedIdx) ?? 0) + 1
    branchCounters.set(resolvedIdx, counter)
    crewBranch.set(i, {
      idx: resolvedIdx,
      name: resolvedBranch.name,
      lat: resolvedBranch.lat,
      lng: resolvedBranch.lng,
      label: `${resolvedBranch.name} Crew ${counter}`,
    })
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

  // ── 2. Single global staging rebalance ──────────────────────────
  // Compute the optimal per-branch crew distribution from where the
  // cycle actually placed work (proximity-weighted by placed visits).
  // Compare to current staging; if different enough to matter, emit
  // ONE suggestion that proposes the whole new distribution. One
  // apply, one regenerate, convergence — no oscillation.
  {
    // Pull placed visits with coords. Walk each one, tally to its
    // nearest branch.
    const placedNearby = new Array(branches.length).fill(0)
    let totalPlacedWithCoords = 0
    for (const v of visits) {
      if (v.status === 'unplaced') continue
      const lat = v.service_locations?.property?.latitude
      const lng = v.service_locations?.property?.longitude
      if (typeof lat !== 'number' || typeof lng !== 'number') continue
      let bestIdx = 0
      let best = Number.POSITIVE_INFINITY
      for (let i = 0; i < branches.length; i++) {
        const d = haversineMiles({ lat, lng }, branches[i])
        if (d < best) { best = d; bestIdx = i }
      }
      placedNearby[bestIdx]++
      totalPlacedWithCoords++
    }
    // Also tally unplaced near each branch — that's demand the next
    // regen can absorb if we shift staging there.
    const unplacedNearby = new Array(branches.length).fill(0)
    let totalUnplaced = 0
    for (const u of unplaced) {
      const lat = u.service_locations?.property?.latitude
      const lng = u.service_locations?.property?.longitude
      if (typeof lat !== 'number' || typeof lng !== 'number') continue
      let bestIdx = 0
      let best = Number.POSITIVE_INFINITY
      for (let i = 0; i < branches.length; i++) {
        const d = haversineMiles({ lat, lng }, branches[i])
        if (d < best) { best = d; bestIdx = i }
      }
      unplacedNearby[bestIdx]++
      totalUnplaced++
    }
    const demand = branches.map((_, i) => placedNearby[i] + unplacedNearby[i])
    const demandTotal = demand.reduce((s, x) => s + x, 0)

    // Proportional allocation across branches with largest-remainder.
    // Floors any branch with demand > 0 at 1 crew so we don't strand
    // properties.
    const proposedCounts = new Array(branches.length).fill(0)
    if (demandTotal > 0 && crewCount > 0 && totalPlacedWithCoords + totalUnplaced > 0) {
      const real = demand.map((d) => (d / demandTotal) * crewCount)
      const floors = real.map((r) => Math.floor(r))
      const remainders = real.map((r, i) => ({ idx: i, frac: r - floors[i] }))
      let allocated = floors.reduce((s, n) => s + n, 0)
      remainders.sort((a, b) => b.frac - a.frac)
      let r = 0
      while (allocated < crewCount && r < remainders.length) {
        floors[remainders[r].idx]++
        allocated++
        r++
      }
      // Floor branches with any demand at 1 (pull from largest holder).
      for (let i = 0; i < branches.length; i++) {
        if (demand[i] > 0 && floors[i] === 0) {
          let largestIdx = 0
          for (let j = 1; j < branches.length; j++) {
            if (floors[j] > floors[largestIdx]) largestIdx = j
          }
          if (largestIdx !== i && floors[largestIdx] > 1) {
            floors[largestIdx]--
            floors[i]++
          }
        }
      }
      for (let i = 0; i < branches.length; i++) proposedCounts[i] = floors[i]
    }

    // Build current vs proposed maps + delta. Skip suggestion if no
    // change of magnitude — small jitters aren't worth a regen.
    const currentPerBranch: Record<string, number> = {}
    const proposedPerBranch: Record<string, number> = {}
    for (let i = 0; i < branches.length; i++) {
      const cur = crewsByBranch.get(i) ?? 0
      const next = proposedCounts[i]
      if (cur > 0) currentPerBranch[branches[i].name] = cur
      if (next > 0) proposedPerBranch[branches[i].name] = next
    }
    const deltaSummary: Array<{ branch_name: string; from: number; to: number; change: number }> = []
    let totalChanges = 0
    for (let i = 0; i < branches.length; i++) {
      const cur = crewsByBranch.get(i) ?? 0
      const next = proposedCounts[i]
      if (cur === next) continue
      deltaSummary.push({
        branch_name: branches[i].name,
        from: cur,
        to: next,
        change: next - cur,
      })
      totalChanges += Math.abs(next - cur)
    }

    if (totalChanges >= 2 && deltaSummary.length > 0) {
      const moves = deltaSummary
        .map((d) =>
          d.change > 0
            ? `${d.branch_name} ${d.from}→${d.to} (+${d.change})`
            : `${d.branch_name} ${d.from}→${d.to} (${d.change})`
        )
        .join(', ')
      suggestions.push({
        id: `sr-${suggestionId++}`,
        type: 'staging_rebalance',
        priority: 500 + totalChanges, // higher than property moves
        title: `Restage ${crewCount} crews to match actual demand`,
        summary:
          `Cycle placed ${totalPlacedWithCoords} visits` +
          (totalUnplaced > 0 ? ` (and ${totalUnplaced} unplaced)` : '') +
          `. Optimal staging by proximity: ${moves}. ` +
          `One apply rewrites the per-branch override; the next regenerate converges in one pass.`,
        current_per_branch: currentPerBranch,
        proposed_per_branch: proposedPerBranch,
        delta_summary: deltaSummary,
        total_crews: crewCount,
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
  //
  // IMPORTANT: the override is PARTIAL. A branch missing from it doesn't
  // mean 0 crews — it just means the user hasn't explicitly staged
  // that branch (the engine fills with defaults / heuristics). So we
  // only treat a branch as "stale-zeroed" when it appears in the
  // override with a value < the threshold, never when it's absent.
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
      // Track even zero entries — a 0 means "explicitly emptied" (relevant)
      // and skip the negative-rebalance fast-path. Both cases need the key
      // present so the lookup can distinguish "absent" from "explicitly 0".
      if (Number.isFinite(n)) liveStaging[k] = n
    }
  }
  const lookupOverride = (name: string): number | null => {
    if (Object.keys(liveStaging).length === 0) return null
    if (liveStaging[name] != null) return liveStaging[name]
    const ci = Object.entries(liveStaging).find(
      ([k]) => k.toLowerCase() === name.toLowerCase()
    )
    return ci ? ci[1] : null // null = not in override (trust engine)
  }
  const beforeFilter = filtered.length
  filtered = filtered.filter((s) => {
    if (s.type === 'staging_rebalance') {
      // Compare proposed_per_branch to live override. If they already
      // match (operator already applied this exact distribution and
      // hasn't regenerated), suppress the duplicate.
      if (Object.keys(liveStaging).length === 0) return true
      const matches = Object.keys(s.proposed_per_branch).every(
        (k) => liveStaging[k] === s.proposed_per_branch[k]
      ) && Object.keys(liveStaging).every(
        (k) => s.proposed_per_branch[k] === liveStaging[k]
      )
      return !matches
    }
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
