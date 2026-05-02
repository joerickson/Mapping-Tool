// Phase 4e — preflight checks against an auto-generated (or recently
// re-generated) cycle. Runs 10 lightweight queries that surface known
// issues so the operator reviews before the cycle goes live.
//
// All checks read from the DB (cycle's scheduled_visits + the template
// + the client's current property set) and return 0-N issues each.
// The aggregator runs them in parallel and persists results to
// cycle_preflight_checks.
import type { SupabaseClient } from '@supabase/supabase-js'
import { getDefaultHolidays } from '../analysis/working-days.js'
import { computeCrewCount } from '../analysis/crew-count.js'
import { evaluateConstraint, type StoredConstraint } from './constraint-evaluator.js'

export type CheckType =
  | 'holiday_in_work_week'
  | 'blackout_date_conflict'
  | 'seasonal_window_violation'
  | 'property_added_since_template'
  | 'property_removed_since_template'
  | 'capacity_overflow'
  | 'cohort_year_transition'
  | 'cohort_unassigned'
  | 'extended_idle_period'
  | 'cycle_starts_during_holiday'

export type Severity = 'blocking' | 'warning' | 'info'

export interface PreflightIssue {
  check_type: CheckType
  severity: Severity
  affected_count?: number
  affected_entity_type?: string
  affected_entity_ids?: string[]
  description: string
  suggested_action?: string
}

export interface PreflightResult {
  has_blocking_issues: boolean
  blocking: PreflightIssue[]
  warnings: PreflightIssue[]
  info: PreflightIssue[]
}

interface CycleContext {
  cycle: {
    id: string
    template_id: string
    cycle_number: number
    start_date: string
    end_date: string
  }
  template: {
    id: string
    client_id: string
    crew_count: number
    cycle_length_days: number
    routed_service_location_ids: string[]
  }
  visits: Array<{
    id: string
    service_location_id: string | null
    property_id: string | null
    scheduled_date: string | null
    crew_day_route_id: string | null
    status: string
    hours_per_visit_total: number | null
    attached_addons: any[] | null
  }>
  crewDays: Array<{
    id: string
    crew_index: number
    crew_label: string | null
    scheduled_date: string
    day_type: string
  }>
  // Per-SL constraints, keyed by service_location_id.
  constraints: Map<string, StoredConstraint[]>
}

async function loadCycleContext(
  db: SupabaseClient,
  cycleId: string
): Promise<CycleContext> {
  const { data: cycle, error: cErr } = await db
    .from('cycle_instances')
    .select('id, template_id, cycle_number, start_date, end_date')
    .eq('id', cycleId)
    .single()
  if (cErr || !cycle) throw new Error(`Cycle not found: ${cErr?.message}`)
  const c = cycle as any

  const { data: template, error: tErr } = await db
    .from('routing_templates')
    .select('id, client_id, crew_count, cycle_length_days, routed_service_location_ids')
    .eq('id', c.template_id)
    .single()
  if (tErr || !template) throw new Error(`Template not found: ${tErr?.message}`)
  const t = template as any

  const { data: visits } = await db
    .from('scheduled_visits')
    .select('id, service_location_id, property_id, scheduled_date, crew_day_route_id, status, hours_per_visit_total, attached_addons')
    .eq('cycle_instance_id', cycleId)
  const v = (visits ?? []) as any[]

  const { data: crewDays } = await db
    .from('crew_day_routes')
    .select('id, crew_index, crew_label, scheduled_date, day_type')
    .eq('cycle_instance_id', cycleId)
  const cd = (crewDays ?? []) as any[]

  // Pull per-SL constraints (date-driven only — what preflight actually
  // checks). Skip if no SLs are referenced.
  const slIds = Array.from(
    new Set(v.map((x) => x.service_location_id).filter(Boolean) as string[])
  )
  const constraints = new Map<string, StoredConstraint[]>()
  if (slIds.length > 0) {
    // Chunk in case of many SLs.
    const CHUNK = 250
    for (let i = 0; i < slIds.length; i += CHUNK) {
      const chunk = slIds.slice(i, i + CHUNK)
      const { data: cons } = await db
        .from('service_location_constraints')
        .select('id, service_location_id, constraint_type, enforcement, config, notes')
        .in('service_location_id', chunk)
      for (const row of (cons ?? []) as any[]) {
        const arr = constraints.get(row.service_location_id) ?? []
        arr.push({
          id: row.id,
          service_location_id: row.service_location_id,
          constraint_type: row.constraint_type,
          enforcement: row.enforcement,
          config: row.config ?? {},
          notes: row.notes ?? null,
        })
        constraints.set(row.service_location_id, arr)
      }
    }
  }

  return { cycle: c, template: t, visits: v, crewDays: cd, constraints }
}

// ── Individual checks ────────────────────────────────────────────────

function checkHolidaysInWorkWeeks(ctx: CycleContext): PreflightIssue[] {
  const start = new Date(`${ctx.cycle.start_date}T00:00:00Z`)
  const end = new Date(`${ctx.cycle.end_date}T23:59:59Z`)
  const holidays = getDefaultHolidays(start, end).filter((h) => h >= start && h <= end)
  const issues: PreflightIssue[] = []
  for (const holiday of holidays) {
    const weekStart = new Date(holiday)
    weekStart.setUTCDate(holiday.getUTCDate() - holiday.getUTCDay()) // Sun
    const weekEnd = new Date(weekStart)
    weekEnd.setUTCDate(weekStart.getUTCDate() + 6)
    const weekVisits = ctx.visits.filter((v) => {
      if (!v.scheduled_date) return false
      const d = new Date(`${v.scheduled_date}T00:00:00Z`)
      return d >= weekStart && d <= weekEnd
    })
    if (weekVisits.length > 0) {
      issues.push({
        check_type: 'holiday_in_work_week',
        severity: 'warning',
        affected_count: weekVisits.length,
        affected_entity_type: 'visit',
        affected_entity_ids: weekVisits.map((v) => v.id),
        description: `${weekVisits.length} visits planned in the week of a federal holiday (${holiday.toISOString().slice(0, 10)})`,
        suggested_action: 'Review visits in this week; consider rescheduling around the holiday',
      })
    }
  }
  return issues
}

function checkBlackoutDateConflicts(ctx: CycleContext): PreflightIssue[] {
  const offenders: Array<{ id: string; description: string }> = []
  for (const v of ctx.visits) {
    if (!v.service_location_id || !v.scheduled_date) continue
    const cs = ctx.constraints.get(v.service_location_id) ?? []
    for (const c of cs) {
      if (c.constraint_type !== 'blackout_dates') continue
      const ev = evaluateConstraint(c, {
        scheduled_date: v.scheduled_date,
        arrival_time: '08:00',
        work_start_time: '08:00',
        work_end_time: '17:00',
        crew_size: 1,
      })
      if (!ev.satisfied && ev.severity === 'hard') {
        offenders.push({ id: v.id, description: ev.description })
      }
    }
  }
  if (offenders.length === 0) return []
  return [
    {
      check_type: 'blackout_date_conflict',
      severity: 'blocking',
      affected_count: offenders.length,
      affected_entity_type: 'visit',
      affected_entity_ids: offenders.map((o) => o.id),
      description: `${offenders.length} visits land on blackout dates`,
      suggested_action: 'Move these visits to a different day before the cycle goes live',
    },
  ]
}

function checkSeasonalWindowViolations(ctx: CycleContext): PreflightIssue[] {
  const offenders: string[] = []
  for (const v of ctx.visits) {
    if (!v.service_location_id || !v.scheduled_date) continue
    const cs = ctx.constraints.get(v.service_location_id) ?? []
    for (const c of cs) {
      if (c.constraint_type !== 'seasonal_window') continue
      const ev = evaluateConstraint(c, {
        scheduled_date: v.scheduled_date,
        arrival_time: '08:00',
        work_start_time: '08:00',
        work_end_time: '17:00',
        crew_size: 1,
      })
      if (!ev.satisfied && ev.severity === 'hard') offenders.push(v.id)
    }
  }
  if (offenders.length === 0) return []
  return [
    {
      check_type: 'seasonal_window_violation',
      severity: 'blocking',
      affected_count: offenders.length,
      affected_entity_type: 'visit',
      affected_entity_ids: offenders,
      description: `${offenders.length} visits fall outside their seasonal window`,
      suggested_action: 'Reschedule these visits within the allowed seasonal range',
    },
  ]
}

async function checkPropertiesAddedSinceTemplate(
  db: SupabaseClient,
  ctx: CycleContext
): Promise<PreflightIssue[]> {
  // Routed SLs in the client today. Compare to the template's snapshot.
  const { data: sls } = await db
    .from('service_locations')
    .select('id')
    .eq('client_id', ctx.template.client_id)
  const currentIds = new Set((sls ?? []).map((r: any) => r.id as string))
  const templateIds = new Set(ctx.template.routed_service_location_ids ?? [])
  const added: string[] = []
  for (const id of currentIds) if (!templateIds.has(id)) added.push(id)
  if (added.length === 0) return []
  return [
    {
      check_type: 'property_added_since_template',
      severity: 'warning',
      affected_count: added.length,
      affected_entity_type: 'service_location',
      affected_entity_ids: added,
      description: `${added.length} new service locations exist on the client but aren't in this template`,
      suggested_action: 'Re-optimize the template to include the new properties before next cycle',
    },
  ]
}

async function checkPropertiesRemovedSinceTemplate(
  db: SupabaseClient,
  ctx: CycleContext
): Promise<PreflightIssue[]> {
  if (!ctx.template.routed_service_location_ids?.length) return []
  // Chunk for URL-length safety — combined templates can have 5000+ ids.
  const allIds = ctx.template.routed_service_location_ids
  const sls: any[] = []
  for (let i = 0; i < allIds.length; i += 250) {
    const chunk = allIds.slice(i, i + 250)
    const { data } = await db
      .from('service_locations')
      .select('id')
      .in('id', chunk)
    sls.push(...(data ?? []))
  }
  const stillExisting = new Set(sls.map((r: any) => r.id as string))
  const removed = ctx.template.routed_service_location_ids.filter(
    (id) => !stillExisting.has(id)
  )
  if (removed.length === 0) return []
  return [
    {
      check_type: 'property_removed_since_template',
      severity: 'warning',
      affected_count: removed.length,
      affected_entity_type: 'service_location',
      affected_entity_ids: removed,
      description: `${removed.length} service locations in the template no longer exist`,
      suggested_action: 'Re-optimize the template to drop the removed properties',
    },
  ]
}

function checkCapacityOverflow(ctx: CycleContext): PreflightIssue[] {
  const placedVisits = ctx.visits.filter((v) => v.status !== 'unplaced')
  if (placedVisits.length === 0) return []
  const result = computeCrewCount({
    routed_visits: placedVisits.map((v) => ({
      service_location_id: v.service_location_id ?? '',
      hours_per_visit: Number(v.hours_per_visit_total ?? 1),
    })),
    cycle_length_days: ctx.template.cycle_length_days,
    cycle_start_date: new Date(`${ctx.cycle.start_date}T00:00:00Z`),
    cycles_per_year: 1,
  })
  if (result.conservative.crews_needed <= ctx.template.crew_count) return []
  return [
    {
      check_type: 'capacity_overflow',
      severity: 'warning',
      affected_count: result.conservative.crews_needed,
      description: `Building-count math estimates ${result.conservative.crews_needed} crews are needed, but the template assumes ${ctx.template.crew_count}`,
      suggested_action: 'Bump crew count on the template, or rebalance branch assignments',
    },
  ]
}

function checkCohortYearTransition(ctx: CycleContext): PreflightIssue[] {
  const startYear = Number(ctx.cycle.start_date.slice(0, 4))
  const endYear = Number(ctx.cycle.end_date.slice(0, 4))
  if (startYear === endYear) return []
  // Count visits with attached addons (those carry cohort_year info).
  const visitsWithAddons = ctx.visits.filter(
    (v) => Array.isArray(v.attached_addons) && v.attached_addons.length > 0
  )
  return [
    {
      check_type: 'cohort_year_transition',
      severity: 'info',
      affected_count: visitsWithAddons.length,
      description: `Cycle spans year boundary (${startYear} → ${endYear}). ${visitsWithAddons.length} visits with addon cohorts may have year-dependent rotations.`,
      suggested_action: 'Spot-check cohort_year on attached addons near the transition date',
    },
  ]
}

async function checkCohortUnassigned(
  db: SupabaseClient,
  ctx: CycleContext
): Promise<PreflightIssue[]> {
  // Properties using addon offerings without cohort assignments.
  const slIds = ctx.template.routed_service_location_ids ?? []
  if (slIds.length === 0) return []
  // Find SLs that have at least one addon-eligible service offering attached.
  const { data: addonOfferings } = await db
    .from('service_offerings')
    .select('id, attaches_to_offering_ids')
    .not('attaches_to_offering_ids', 'is', null)
  const addonOfferingIds = (addonOfferings ?? [])
    .map((o: any) => o.id as string)
    .filter(Boolean)
  if (addonOfferingIds.length === 0) return []
  // Get cohort assignments for SLs in this template using these addons.
  const { data: assignments } = await db
    .from('addon_cohort_assignments')
    .select('service_location_id, service_offering_id, cohort_index')
    .in('service_offering_id', addonOfferingIds)
  const assignmentSet = new Set(
    (assignments ?? []).map((a: any) => `${a.service_location_id}::${a.service_offering_id}`)
  )
  // Find SLs that have an addon offering but no cohort assignment for it.
  // Simplified heuristic: only count SLs whose offering is in addonOfferingIds.
  const CHUNK = 250
  const unassignedSlIds = new Set<string>()
  for (let i = 0; i < slIds.length; i += CHUNK) {
    const chunk = slIds.slice(i, i + CHUNK)
    const { data: sls } = await db
      .from('service_locations')
      .select('id, service_offering_id')
      .in('id', chunk)
    for (const sl of (sls ?? []) as any[]) {
      if (!sl.service_offering_id) continue
      if (!addonOfferingIds.includes(sl.service_offering_id)) continue
      const key = `${sl.id}::${sl.service_offering_id}`
      if (!assignmentSet.has(key)) unassignedSlIds.add(sl.id)
    }
  }
  if (unassignedSlIds.size === 0) return []
  return [
    {
      check_type: 'cohort_unassigned',
      severity: 'warning',
      affected_count: unassignedSlIds.size,
      affected_entity_type: 'service_location',
      affected_entity_ids: Array.from(unassignedSlIds),
      description: `${unassignedSlIds.size} service locations use addon offerings without cohort assignments`,
      suggested_action: 'Run cohort auto-assignment, or set cohort manually on these properties',
    },
  ]
}

function checkExtendedIdle(ctx: CycleContext): PreflightIssue[] {
  // Group crew_days by crew_index, sort by date, find streaks of working
  // days where the crew has no scheduled work.
  const byCrew = new Map<number, Map<string, boolean>>()
  for (const cd of ctx.crewDays) {
    const m = byCrew.get(cd.crew_index) ?? new Map<string, boolean>()
    m.set(cd.scheduled_date, true)
    byCrew.set(cd.crew_index, m)
  }
  const issues: PreflightIssue[] = []
  // Walk every working day in the cycle for each crew.
  const start = new Date(`${ctx.cycle.start_date}T00:00:00Z`)
  const end = new Date(`${ctx.cycle.end_date}T00:00:00Z`)
  for (const [crewIdx, busyMap] of byCrew) {
    let streakStart: Date | null = null
    let streakLen = 0
    const cur = new Date(start)
    while (cur <= end) {
      const dow = cur.getUTCDay()
      const isWeekday = dow !== 0 && dow !== 6
      const dateKey = cur.toISOString().slice(0, 10)
      const busy = busyMap.has(dateKey)
      if (isWeekday && !busy) {
        if (!streakStart) streakStart = new Date(cur)
        streakLen++
      } else if (streakStart) {
        if (streakLen >= 5) {
          const streakEnd = new Date(cur)
          streakEnd.setUTCDate(cur.getUTCDate() - 1)
          issues.push({
            check_type: 'extended_idle_period',
            severity: 'info',
            affected_count: streakLen,
            description: `Crew ${crewIdx + 1}: ${streakLen} consecutive idle weekdays (${streakStart.toISOString().slice(0, 10)} – ${streakEnd.toISOString().slice(0, 10)})`,
            suggested_action: 'Redistribute work or lower crew count if this is structural',
          })
        }
        streakStart = null
        streakLen = 0
      }
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
    // Tail streak
    if (streakStart && streakLen >= 5) {
      const streakEnd = new Date(end)
      issues.push({
        check_type: 'extended_idle_period',
        severity: 'info',
        affected_count: streakLen,
        description: `Crew ${crewIdx + 1}: ${streakLen} consecutive idle weekdays through end of cycle (${streakStart.toISOString().slice(0, 10)} – ${streakEnd.toISOString().slice(0, 10)})`,
        suggested_action: 'Redistribute work or lower crew count if this is structural',
      })
    }
  }
  return issues
}

function checkCycleStartsDuringHoliday(ctx: CycleContext): PreflightIssue[] {
  const start = new Date(`${ctx.cycle.start_date}T00:00:00Z`)
  // Look at holidays in the start week.
  const weekStart = new Date(start)
  weekStart.setUTCDate(start.getUTCDate() - start.getUTCDay())
  const weekEnd = new Date(weekStart)
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6)
  const holidays = getDefaultHolidays(weekStart, weekEnd).filter(
    (h) => h >= weekStart && h <= weekEnd
  )
  if (holidays.length === 0) return []
  return [
    {
      check_type: 'cycle_starts_during_holiday',
      severity: 'warning',
      affected_count: holidays.length,
      description: `Cycle starts the week of a federal holiday (${holidays.map((h) => h.toISOString().slice(0, 10)).join(', ')})`,
      suggested_action: 'Consider shifting the start date a week to capture a full first work week',
    },
  ]
}

// ── Aggregator ───────────────────────────────────────────────────────

export async function runPreflightChecks(
  db: SupabaseClient,
  cycleInstanceId: string
): Promise<PreflightResult> {
  const ctx = await loadCycleContext(db, cycleInstanceId)
  const all = await Promise.all([
    Promise.resolve(checkHolidaysInWorkWeeks(ctx)),
    Promise.resolve(checkBlackoutDateConflicts(ctx)),
    Promise.resolve(checkSeasonalWindowViolations(ctx)),
    checkPropertiesAddedSinceTemplate(db, ctx),
    checkPropertiesRemovedSinceTemplate(db, ctx),
    Promise.resolve(checkCapacityOverflow(ctx)),
    Promise.resolve(checkCohortYearTransition(ctx)),
    checkCohortUnassigned(db, ctx),
    Promise.resolve(checkExtendedIdle(ctx)),
    Promise.resolve(checkCycleStartsDuringHoliday(ctx)),
  ])
  const flat = all.flat()
  return {
    has_blocking_issues: flat.some((i) => i.severity === 'blocking'),
    blocking: flat.filter((i) => i.severity === 'blocking'),
    warnings: flat.filter((i) => i.severity === 'warning'),
    info: flat.filter((i) => i.severity === 'info'),
  }
}

// Persist preflight results to cycle_preflight_checks. Replaces any
// existing UN-acknowledged rows for this cycle so re-runs don't
// accumulate stale duplicates; acknowledged rows are left in place
// for audit.
export async function persistPreflightResults(
  db: SupabaseClient,
  cycleInstanceId: string,
  templateId: string,
  result: PreflightResult
): Promise<void> {
  await db
    .from('cycle_preflight_checks')
    .delete()
    .eq('cycle_instance_id', cycleInstanceId)
    .eq('acknowledged', false)
  const rows: any[] = []
  for (const i of [...result.blocking, ...result.warnings, ...result.info]) {
    rows.push({
      cycle_instance_id: cycleInstanceId,
      template_id: templateId,
      check_type: i.check_type,
      severity: i.severity,
      affected_count: i.affected_count ?? null,
      affected_entity_type: i.affected_entity_type ?? null,
      affected_entity_ids: i.affected_entity_ids ?? [],
      description: i.description,
      suggested_action: i.suggested_action ?? null,
    })
  }
  if (rows.length > 0) {
    await db.from('cycle_preflight_checks').insert(rows)
  }
}
