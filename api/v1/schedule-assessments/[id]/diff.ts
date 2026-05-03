// GET /api/v1/schedule-assessments/[id]/diff
//
// Compares the assessment's matched rows ("current schedule" — what the
// operator uploaded) against the optimized baseline ("what the engine
// produced"). The baseline is the most recent cycle of the assessment's
// linked baseline_template_id.
//
// Output: 4 categorized buckets the wizard renders:
//   only_current  — uploaded for an SL the optimized cycle doesn't visit
//   only_optimized — engine schedules an SL the upload doesn't include
//   moved_date    — same SL, different scheduled_date (and possibly crew)
//   matched_same  — SL on the same date in both (no action needed)
// Plus aggregate stats so the operator can see drive-time / day-count
// deltas at a glance.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import { computeCrewUtilization } from '../../../_lib/scheduler/crew-utilization.js'

type DiffStatus = 'only_current' | 'only_optimized' | 'moved_date' | 'matched_same'

interface DiffRow {
  status: DiffStatus
  service_location_id: string | null
  display_name: string | null
  current_date: string | null
  current_crew: string | null
  optimized_date: string | null
  optimized_crew: string | null
  // Hybrid key the user's per-row choice is stored under (sl_id|idx).
  // Surfacing it lets the frontend's recommendation buttons patch
  // multiple rows in one PATCH without re-deriving the key.
  hybrid_key?: string
  // Per-row hybrid override choice (set by the user via the wizard).
  hybrid_choice?: 'current' | 'optimized' | 'skip' | null
}

type RecommendationKind = 'move_date' | 'add_visits' | 'remove_visits'
interface Recommendation {
  id: string
  kind: RecommendationKind
  title: string
  description: string
  visit_count: number
  // hybrid keys to patch when the user accepts this recommendation.
  affected_keys: string[]
  // What hybrid_choice to set on the affected rows.
  apply_choice: 'current' | 'optimized' | 'skip'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try { await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const id = req.query.id as string
  const db = createAdminClient()

  const { data: assessment } = await db
    .from('schedule_assessments')
    .select('id, baseline_template_id, hybrid_overrides')
    .eq('id', id)
    .maybeSingle()
  if (!assessment) return res.status(404).json({ error: 'Assessment not found' })
  const a = assessment as any
  const overrides = (a.hybrid_overrides ?? {}) as Record<
    string,
    { source?: 'current' | 'optimized' | 'skip' }
  >

  if (!a.baseline_template_id) {
    return res.status(400).json({
      error: 'No baseline_template_id set on this assessment. Pick a routing template to compare against.',
      code: 'NO_BASELINE',
    })
  }

  // Pull this template's most recent cycle.
  const { data: cycleRow } = await db
    .from('cycle_instances')
    .select('id, start_date, end_date, generated_at')
    .eq('template_id', a.baseline_template_id)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!cycleRow) {
    return res.status(400).json({
      error: 'Linked template has no generated cycle yet. Generate a cycle on the template first, then come back.',
      code: 'NO_CYCLE',
    })
  }
  const cycleId = (cycleRow as any).id

  // Page through scheduled_visits for the cycle (1000-cap protection).
  const PAGE = 1000
  const optimizedVisits: Array<{ sl_id: string; date: string | null; crew: string | null; address: string | null; status: string }> = []
  for (let p = 0; p < 50; p++) {
    const { data } = await db
      .from('scheduled_visits')
      .select('id, status, service_location_id, scheduled_date, crew_index, service_locations(display_name, property:properties(address_line1))')
      .eq('cycle_instance_id', cycleId)
      .range(p * PAGE, p * PAGE + PAGE - 1)
    const arr = data ?? []
    for (const v of arr as any[]) {
      optimizedVisits.push({
        sl_id: v.service_location_id,
        date: v.scheduled_date,
        crew: v.crew_index != null ? `Crew ${Number(v.crew_index) + 1}` : null,
        address: v.service_locations?.property?.address_line1 ?? v.service_locations?.display_name ?? null,
        status: v.status,
      })
    }
    if (arr.length < PAGE) break
  }
  // Resolve crew_label per crew_index by sampling crew_day_routes.
  const { data: cdRows } = await db
    .from('crew_day_routes')
    .select('crew_index, crew_label')
    .eq('cycle_instance_id', cycleId)
    .limit(500)
  const crewLabelByIdx = new Map<number, string>()
  for (const r of (cdRows ?? []) as any[]) {
    if (typeof r.crew_index === 'number' && !crewLabelByIdx.has(r.crew_index)) {
      crewLabelByIdx.set(r.crew_index, r.crew_label ?? `Crew ${r.crew_index + 1}`)
    }
  }
  // Repopulate crew labels with the canonical name.
  for (const v of optimizedVisits) {
    if (v.crew) {
      const idx = parseInt(v.crew.replace(/\D+/g, ''), 10) - 1
      if (Number.isFinite(idx) && crewLabelByIdx.has(idx)) {
        v.crew = crewLabelByIdx.get(idx)!
      }
    }
  }

  // Pull all matched assessment rows.
  const matchedRows: any[] = []
  for (let p = 0; p < 50; p++) {
    const { data } = await db
      .from('schedule_assessment_rows')
      .select('id, raw_address, raw_scheduled_date, raw_crew_name, matched_service_location_id, match_status, service_locations(display_name, property:properties(address_line1))')
      .eq('assessment_id', id)
      .in('match_status', ['auto', 'manual'])
      .not('matched_service_location_id', 'is', null)
      .range(p * PAGE, p * PAGE + PAGE - 1)
    const arr = data ?? []
    matchedRows.push(...arr)
    if (arr.length < PAGE) break
  }

  // Build diff. An SL may have multiple rows in either side (multi-visit
  // per cycle). For v1 we treat each as an independent visit slot —
  // pair them by date proximity.
  const optimizedBySl = new Map<string, typeof optimizedVisits>()
  for (const v of optimizedVisits) {
    const arr = optimizedBySl.get(v.sl_id) ?? []
    arr.push(v)
    optimizedBySl.set(v.sl_id, arr)
  }
  const currentBySl = new Map<string, any[]>()
  for (const r of matchedRows as any[]) {
    const sl = r.matched_service_location_id
    const arr = currentBySl.get(sl) ?? []
    arr.push(r)
    currentBySl.set(sl, arr)
  }

  const diff: DiffRow[] = []
  const allSlIds = new Set([...optimizedBySl.keys(), ...currentBySl.keys()])
  for (const slId of allSlIds) {
    const opts = optimizedBySl.get(slId) ?? []
    const curs = currentBySl.get(slId) ?? []
    const optsSorted = [...opts].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
    const cursSorted = [...curs].sort((a, b) =>
      (a.raw_scheduled_date ?? '').localeCompare(b.raw_scheduled_date ?? '')
    )
    const len = Math.max(optsSorted.length, cursSorted.length)
    for (let i = 0; i < len; i++) {
      const o = optsSorted[i]
      const c = cursSorted[i]
      const hybridKey = `${slId}|${i}`
      const choice = (overrides[hybridKey]?.source ?? null) as DiffRow['hybrid_choice']
      if (o && !c) {
        diff.push({
          status: 'only_optimized',
          service_location_id: slId,
          display_name: o.address ?? null,
          current_date: null,
          current_crew: null,
          optimized_date: o.date,
          optimized_crew: o.crew,
          hybrid_key: hybridKey,
          hybrid_choice: choice,
        })
      } else if (c && !o) {
        diff.push({
          status: 'only_current',
          service_location_id: slId,
          display_name: c.service_locations?.property?.address_line1 ?? c.raw_address,
          current_date: c.raw_scheduled_date,
          current_crew: c.raw_crew_name,
          optimized_date: null,
          optimized_crew: null,
          hybrid_key: hybridKey,
          hybrid_choice: choice,
        })
      } else if (c && o) {
        const sameDate = c.raw_scheduled_date === o.date
        diff.push({
          status: sameDate ? 'matched_same' : 'moved_date',
          service_location_id: slId,
          display_name: o.address ?? c.service_locations?.property?.address_line1 ?? c.raw_address,
          current_date: c.raw_scheduled_date,
          current_crew: c.raw_crew_name,
          optimized_date: o.date,
          optimized_crew: o.crew,
          hybrid_key: hybridKey,
          hybrid_choice: choice,
        })
      }
    }
  }

  // Aggregates.
  const counts = {
    only_current: diff.filter((d) => d.status === 'only_current').length,
    only_optimized: diff.filter((d) => d.status === 'only_optimized').length,
    moved_date: diff.filter((d) => d.status === 'moved_date').length,
    matched_same: diff.filter((d) => d.status === 'matched_same').length,
  }

  // Schedule health summary — three numbers the operator should see
  // before any row-level data: how aligned is the current schedule
  // already, and what does the optimized cycle look like overall.
  const totalEvaluated = counts.only_current + counts.only_optimized + counts.moved_date + counts.matched_same
  const matchRatePct = totalEvaluated > 0 ? Math.round((counts.matched_same / totalEvaluated) * 100) : 0

  let optimizedTotalHours = 0
  let optimizedUtilizationPct = 0
  let optimizedIdleDays = 0
  let optimizedWorkdayCount = 0
  try {
    const utilDays = await computeCrewUtilization(db, cycleId)
    let usedDays = 0
    for (const d of utilDays) {
      optimizedTotalHours += d.work_hours_scheduled
      if (d.state.kind === 'idle') optimizedIdleDays++
      if (d.utilization_pct > 0) usedDays++
    }
    optimizedWorkdayCount = utilDays.length
    optimizedUtilizationPct =
      optimizedWorkdayCount > 0 ? Math.round((usedDays / optimizedWorkdayCount) * 100) : 0
  } catch {
    // Util compute is best-effort — diff still loads if it fails.
  }

  const health = {
    match_rate_pct: matchRatePct,
    visits_already_optimal: counts.matched_same,
    visits_to_move: counts.moved_date,
    visits_to_add: counts.only_optimized,
    visits_to_remove: counts.only_current,
    total_evaluated: totalEvaluated,
    optimized_total_hours: Math.round(optimizedTotalHours * 10) / 10,
    optimized_utilization_pct: optimizedUtilizationPct,
    optimized_idle_days: optimizedIdleDays,
    optimized_workday_count: optimizedWorkdayCount,
  }

  // Recommendations — the actionable summary. Group date moves by
  // (from_date → to_date) so "move 6 visits from Mon → Thu" reads as
  // one operation, then add catch-all entries for adds/removes.
  const recommendations: Recommendation[] = []
  const moveGroups = new Map<string, DiffRow[]>()
  for (const d of diff) {
    if (d.status !== 'moved_date') continue
    const k = `${d.current_date ?? '?'}→${d.optimized_date ?? '?'}`
    const arr = moveGroups.get(k) ?? []
    arr.push(d)
    moveGroups.set(k, arr)
  }
  const fmtDate = (s: string | null) => {
    if (!s) return '?'
    const dt = new Date(s + 'T00:00:00Z')
    if (Number.isNaN(dt.getTime())) return s
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getUTCDay()]
    const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dt.getUTCMonth()]
    return `${dow} ${mon} ${dt.getUTCDate()}`
  }
  const sortedMoveGroups = Array.from(moveGroups.entries()).sort(
    (a, b) => b[1].length - a[1].length
  )
  for (const [key, rows] of sortedMoveGroups) {
    const [from, to] = key.split('→')
    recommendations.push({
      id: `move_${key}`,
      kind: 'move_date',
      title: `Move ${rows.length} visit${rows.length === 1 ? '' : 's'} from ${fmtDate(from)} → ${fmtDate(to)}`,
      description: `The optimized cycle puts these properties on ${fmtDate(to)} instead of ${fmtDate(from)}. Accepting moves them to the engine's date.`,
      visit_count: rows.length,
      affected_keys: rows.map((r) => r.hybrid_key!).filter(Boolean),
      apply_choice: 'optimized',
    })
  }
  if (counts.only_optimized > 0) {
    const rows = diff.filter((d) => d.status === 'only_optimized')
    recommendations.push({
      id: 'add_visits',
      kind: 'add_visits',
      title: `Add ${rows.length} visit${rows.length === 1 ? '' : 's'} the engine schedules but the upload skips`,
      description: `These properties appear in the optimized cycle but not in the uploaded schedule. Accepting adds them to the hybrid template.`,
      visit_count: rows.length,
      affected_keys: rows.map((r) => r.hybrid_key!).filter(Boolean),
      apply_choice: 'optimized',
    })
  }
  if (counts.only_current > 0) {
    const rows = diff.filter((d) => d.status === 'only_current')
    recommendations.push({
      id: 'remove_visits',
      kind: 'remove_visits',
      title: `Skip ${rows.length} visit${rows.length === 1 ? '' : 's'} the optimized cycle drops`,
      description: `These properties are in the upload but the engine's optimized plan doesn't visit them this cycle. Accepting marks them as skipped.`,
      visit_count: rows.length,
      affected_keys: rows.map((r) => r.hybrid_key!).filter(Boolean),
      apply_choice: 'skip',
    })
  }

  return res.status(200).json({
    cycle: {
      id: cycleId,
      start_date: (cycleRow as any).start_date,
      end_date: (cycleRow as any).end_date,
    },
    counts,
    health,
    recommendations,
    diff,
  })
}
