// Phase 4e — side-by-side cycle comparison.
//
// Loads both cycles' summary metrics + visit/crew detail and computes
// deltas. Both cycles must belong to the same template (else throws).
import type { SupabaseClient } from '@supabase/supabase-js'

interface CycleSummary {
  id: string
  template_id: string
  cycle_number: number
  start_date: string
  end_date: string
  status: string
  crew_count: number
  total_visits: number
  visits_completed: number
  visits_cancelled: number
  visits_unplaced: number
  total_drive_miles: number
  total_work_hours: number
  total_overnight_nights: number
  total_estimated_cost: number
  hard_constraint_violations: number
  soft_constraint_violations: number
  visit_counts_by_status: Record<string, number>
  crews_used: number
}

interface CompareSide {
  cycle: CycleSummary
}

export interface ComparisonResult {
  left: CompareSide
  right: CompareSide
  deltas: {
    total_visits: Delta
    total_drive_miles: Delta
    total_work_hours: Delta
    total_overnight_nights: Delta
    total_estimated_cost: Delta
    crews_used: Delta
    hard_constraint_violations: Delta
    soft_constraint_violations: Delta
    properties_added: string[]
    properties_removed: string[]
    properties_with_changed_crew: Array<{
      property_id: string
      left_crew: number | null
      right_crew: number | null
    }>
    properties_with_changed_date: Array<{
      property_id: string
      left_date: string | null
      right_date: string | null
    }>
  }
}

interface Delta {
  left: number
  right: number
  delta: number
  pct_change: number
}

function delta(left: number, right: number): Delta {
  const d = right - left
  return {
    left,
    right,
    delta: d,
    pct_change: left === 0 ? (right === 0 ? 0 : 100) : Math.round((d / left) * 1000) / 10,
  }
}

async function loadOneCycle(
  db: SupabaseClient,
  cycleId: string
): Promise<{
  summary: CycleSummary
  visits: Array<{
    property_id: string | null
    scheduled_date: string | null
    crew_day_route_id: string | null
    status: string
  }>
  crewDays: Array<{ id: string; crew_index: number }>
}> {
  const { data: cycle, error: cErr } = await db
    .from('cycle_instances')
    .select(
      'id, template_id, cycle_number, start_date, end_date, status, ' +
        'total_visits, total_drive_miles, total_work_minutes, total_overnight_nights, ' +
        'total_estimated_cost, hard_constraint_violations, soft_constraint_violations'
    )
    .eq('id', cycleId)
    .single()
  if (cErr || !cycle) throw new Error(`Cycle ${cycleId} not found: ${cErr?.message}`)
  const c = cycle as any

  const { data: tpl } = await db
    .from('routing_templates')
    .select('crew_count')
    .eq('id', c.template_id)
    .single()
  const crewCount = Number((tpl as any)?.crew_count ?? 0)

  const { data: visits } = await db
    .from('scheduled_visits')
    .select('property_id, scheduled_date, crew_day_route_id, status')
    .eq('cycle_instance_id', cycleId)
  const v = (visits ?? []) as any[]

  const { data: crewDays } = await db
    .from('crew_day_routes')
    .select('id, crew_index')
    .eq('cycle_instance_id', cycleId)
  const cd = (crewDays ?? []) as any[]

  const counts: Record<string, number> = {}
  let completed = 0
  let cancelled = 0
  let unplaced = 0
  for (const x of v) {
    counts[x.status] = (counts[x.status] ?? 0) + 1
    if (x.status === 'completed') completed++
    else if (x.status === 'cancelled') cancelled++
    else if (x.status === 'unplaced') unplaced++
  }
  const crewsUsed = new Set(cd.map((x) => x.crew_index)).size

  const summary: CycleSummary = {
    id: c.id,
    template_id: c.template_id,
    cycle_number: c.cycle_number,
    start_date: c.start_date,
    end_date: c.end_date,
    status: c.status,
    crew_count: crewCount,
    total_visits: Number(c.total_visits ?? v.length),
    visits_completed: completed,
    visits_cancelled: cancelled,
    visits_unplaced: unplaced,
    total_drive_miles: Number(c.total_drive_miles ?? 0),
    total_work_hours: Math.round((Number(c.total_work_minutes ?? 0) / 60) * 10) / 10,
    total_overnight_nights: Number(c.total_overnight_nights ?? 0),
    total_estimated_cost: Number(c.total_estimated_cost ?? 0),
    hard_constraint_violations: Number(c.hard_constraint_violations ?? 0),
    soft_constraint_violations: Number(c.soft_constraint_violations ?? 0),
    visit_counts_by_status: counts,
    crews_used: crewsUsed,
  }
  return { summary, visits: v, crewDays: cd }
}

export async function compareCycles(
  db: SupabaseClient,
  leftId: string,
  rightId: string
): Promise<ComparisonResult> {
  const [left, right] = await Promise.all([loadOneCycle(db, leftId), loadOneCycle(db, rightId)])
  if (left.summary.template_id !== right.summary.template_id) {
    throw new Error('Cycles must belong to the same template')
  }

  // Build crew_index lookup per cycle for visits.
  const leftCrewByRoute = new Map<string, number>()
  for (const cd of left.crewDays) leftCrewByRoute.set(cd.id, cd.crew_index)
  const rightCrewByRoute = new Map<string, number>()
  for (const cd of right.crewDays) rightCrewByRoute.set(cd.id, cd.crew_index)

  const leftVisitByProp = new Map<
    string,
    { date: string | null; crew: number | null }
  >()
  for (const v of left.visits) {
    if (!v.property_id) continue
    leftVisitByProp.set(v.property_id, {
      date: v.scheduled_date,
      crew: v.crew_day_route_id ? leftCrewByRoute.get(v.crew_day_route_id) ?? null : null,
    })
  }
  const rightVisitByProp = new Map<
    string,
    { date: string | null; crew: number | null }
  >()
  for (const v of right.visits) {
    if (!v.property_id) continue
    rightVisitByProp.set(v.property_id, {
      date: v.scheduled_date,
      crew: v.crew_day_route_id ? rightCrewByRoute.get(v.crew_day_route_id) ?? null : null,
    })
  }

  const leftPropIds = new Set(leftVisitByProp.keys())
  const rightPropIds = new Set(rightVisitByProp.keys())
  const propertiesAdded: string[] = []
  const propertiesRemoved: string[] = []
  for (const id of rightPropIds) if (!leftPropIds.has(id)) propertiesAdded.push(id)
  for (const id of leftPropIds) if (!rightPropIds.has(id)) propertiesRemoved.push(id)

  const propertiesWithChangedCrew: ComparisonResult['deltas']['properties_with_changed_crew'] = []
  const propertiesWithChangedDate: ComparisonResult['deltas']['properties_with_changed_date'] = []
  for (const [pid, lv] of leftVisitByProp) {
    const rv = rightVisitByProp.get(pid)
    if (!rv) continue
    if (lv.crew !== rv.crew) {
      propertiesWithChangedCrew.push({ property_id: pid, left_crew: lv.crew, right_crew: rv.crew })
    }
    if (lv.date !== rv.date) {
      propertiesWithChangedDate.push({ property_id: pid, left_date: lv.date, right_date: rv.date })
    }
  }

  return {
    left: { cycle: left.summary },
    right: { cycle: right.summary },
    deltas: {
      total_visits: delta(left.summary.total_visits, right.summary.total_visits),
      total_drive_miles: delta(left.summary.total_drive_miles, right.summary.total_drive_miles),
      total_work_hours: delta(left.summary.total_work_hours, right.summary.total_work_hours),
      total_overnight_nights: delta(
        left.summary.total_overnight_nights,
        right.summary.total_overnight_nights
      ),
      total_estimated_cost: delta(
        left.summary.total_estimated_cost,
        right.summary.total_estimated_cost
      ),
      crews_used: delta(left.summary.crews_used, right.summary.crews_used),
      hard_constraint_violations: delta(
        left.summary.hard_constraint_violations,
        right.summary.hard_constraint_violations
      ),
      soft_constraint_violations: delta(
        left.summary.soft_constraint_violations,
        right.summary.soft_constraint_violations
      ),
      properties_added: propertiesAdded,
      properties_removed: propertiesRemoved,
      properties_with_changed_crew: propertiesWithChangedCrew,
      properties_with_changed_date: propertiesWithChangedDate,
    },
  }
}
