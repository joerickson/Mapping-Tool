// POST /api/scheduler/cycles/[cycleId]/rebalance-suggestions
//
// After cycle generation, if anything's unplaced, find candidate
// "trips" (clusters' visits that overflowed) and the best recipient
// crews to move them to. Returns ranked recommendations the operator
// can apply with one click.
//
// Logic is deterministic — no LLM — so it's fast and predictable.
// The recipient must have:
//   - Idle workdays ≥ the unplaced count for that cluster
//   - Branch within 2× cluster_radius_miles of the cluster centroid
// Among feasible recipients, prefer (a) most idle days, (b) shortest
// drive from their branch to cluster centroid.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import { haversineMiles } from '../../../_lib/analysis/haversine.js'

export const config = { maxDuration: 30 }

interface Suggestion {
  id: string
  title: string
  summary: string
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const cycleId = req.query.cycleId as string
  if (!cycleId) return res.status(400).json({ error: 'cycleId required' })
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

  // Page through visits + crew_day_routes (same pattern as cycle GET).
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
      .select('id, crew_index, scheduled_date, day_type, total_work_minutes, total_drive_minutes, total_day_minutes, route, trip_id, start_location')
      .eq('cycle_instance_id', cycleId)
      .range(p * PAGE, (p + 1) * PAGE - 1)
    const batch = data ?? []
    crewDays.push(...batch)
    if (batch.length < PAGE) break
  }

  const unplaced = visits.filter((v) => v.status === 'unplaced')
  if (unplaced.length === 0) {
    return res.status(200).json({ suggestions: [] })
  }

  // ── Build crew context: per-crew branch coords + idle workday count ─
  const branches = (template.branches ?? []) as Array<{ name: string; lat: number; lng: number }>
  const cfg = (template.config ?? {}) as Record<string, any>
  const clusterRadius = (cfg.cluster_radius_miles as number) ?? 30

  // Crew → branch coords (from any of their crew_day_routes' start_location).
  const crewBranchByIdx = new Map<number, { idx: number; name: string; lat: number; lng: number }>()
  for (const cd of crewDays) {
    if (crewBranchByIdx.has(cd.crew_index)) continue
    const sl = cd.start_location ?? null
    if (!sl || typeof sl.lat !== 'number' || typeof sl.lng !== 'number') continue
    // Match the crew's branch coords to one of template.branches by lat/lng.
    let matchedIdx = 0
    let bestDist = Number.POSITIVE_INFINITY
    for (let i = 0; i < branches.length; i++) {
      const d = haversineMiles({ lat: sl.lat, lng: sl.lng }, branches[i])
      if (d < bestDist) {
        bestDist = d
        matchedIdx = i
      }
    }
    crewBranchByIdx.set(cd.crew_index, {
      idx: matchedIdx,
      name: sl.name ?? branches[matchedIdx]?.name ?? `Crew ${cd.crew_index + 1}`,
      lat: sl.lat,
      lng: sl.lng,
    })
  }
  // Fall back: any crews without routes get their template-order branch.
  const declaredCrewCount = (template.crew_count as number) ?? crewBranchByIdx.size
  for (let i = 0; i < declaredCrewCount; i++) {
    if (crewBranchByIdx.has(i)) continue
    const b = branches[i % Math.max(1, branches.length)]
    if (b) crewBranchByIdx.set(i, { idx: i % branches.length, name: b.name, lat: b.lat, lng: b.lng })
  }

  // Compute idle workdays per crew (cycle workdays - days with routes).
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
  for (const idx of crewBranchByIdx.keys()) {
    const used = usedByCrew.get(idx) ?? new Set()
    idleByCrew.set(idx, workdays.filter((d) => !used.has(d)).length)
  }

  // ── Group unplaced by their cluster_label (parsed from reason) ────
  // The unplaced reason format is: "Trip ran out of cycle days for cluster <Label> ..."
  // or "Trip "<Label>" extended past cycle end ..."
  const groups = new Map<string, { label: string; props: any[] }>()
  for (const u of unplaced) {
    const reason: string = u.unplaced_reason ?? ''
    let label = 'Unknown'
    const m1 = reason.match(/cluster\s+([^()]+?)(?:\s+\()/) // "cluster Frisco (local)"
    const m2 = reason.match(/Trip\s+"([^"]+)"/) // 'Trip "Broken Arrow, OK"'
    if (m1) label = m1[1].trim()
    else if (m2) label = m2[1].trim()
    const g = groups.get(label) ?? { label, props: [] }
    g.props.push(u)
    groups.set(label, g)
  }

  // For each group, compute centroid + nearest-branch (the "from" branch),
  // then find candidate recipients with capacity + reasonable geography.
  const overrides = (template.branch_assignment_overrides ?? {}) as Record<string, number>
  const suggestions: Suggestion[] = []
  let suggestionId = 1
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

    // From: the closest crew branch (where these properties currently sit).
    let fromBranchIdx = 0
    let fromDist = Number.POSITIVE_INFINITY
    for (const [, b] of crewBranchByIdx) {
      const d = haversineMiles({ lat: centroidLat, lng: centroidLng }, b)
      if (d < fromDist) {
        fromDist = d
        fromBranchIdx = b.idx
      }
    }

    // To: best recipient = enough idle days + closest non-from branch within 2×radius.
    const candidates = Array.from(crewBranchByIdx.values())
      .filter((b) => b.idx !== fromBranchIdx)
      .map((b) => ({
        b,
        dist: haversineMiles({ lat: centroidLat, lng: centroidLng }, b),
        idle: idleByCrew.get(b.idx) ?? 0,
      }))
      .filter((c) => c.idle >= validProps.length)
      .filter((c) => c.dist <= clusterRadius * 2)
      .sort((a, c) => a.dist - c.dist)

    if (candidates.length === 0) continue
    const best = candidates[0]

    suggestions.push({
      id: `sug-${suggestionId++}`,
      title: `Move ${label} (${validProps.length} propert${validProps.length === 1 ? 'y' : 'ies'}) → ${best.b.name}`,
      summary:
        `${validProps.length} unplaced ${label} propert${validProps.length === 1 ? 'y' : 'ies'} ` +
        `currently routed via ${branches[fromBranchIdx]?.name ?? 'origin'}. ` +
        `${best.b.name} has ${best.idle} idle workdays and is ` +
        `${Math.round(best.dist)}mi from the cluster (vs ${Math.round(fromDist)}mi from ` +
        `${branches[fromBranchIdx]?.name ?? 'origin'} — adds ~${Math.max(0, Math.round((best.dist - fromDist) * 2 / 60))}h drive per trip).`,
      from_branch_idx: fromBranchIdx,
      from_branch_name: branches[fromBranchIdx]?.name ?? `Branch ${fromBranchIdx}`,
      to_branch_idx: best.b.idx,
      to_branch_name: best.b.name,
      property_count: validProps.length,
      service_location_ids: validProps.map((u) => u.service_location_id),
      property_ids: validProps.map((u) => u.property_id),
      cluster_label: label,
      drive_delta_miles: Math.round(best.dist - fromDist),
    })
  }

  // Skip suggestions whose targets the operator already overrode.
  const filtered = suggestions.filter((s) =>
    s.service_location_ids.some((sl) => overrides[sl] !== s.to_branch_idx)
  )

  return res.status(200).json({ suggestions: filtered })
}
