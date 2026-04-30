// Phase 4d — materialize a cycle instance from a routing template.
// Phase 4f-3+ — bulk-insert hot path so generation doesn't hit Vercel's
// maxDuration on big cycles. Pre-allocate UUIDs in JS so visits can
// reference their crew_day_route_id without a per-row roundtrip.
//
// Walks the template.trips structure, converts relative_start_day +
// trip_day_number into actual calendar dates, and re-checks each
// attached addon against the latest addon_cohort_assignments (an addon
// already completed since the template was built gets dropped from
// this cycle's visit).
import type { SupabaseClient } from '@supabase/supabase-js'
import crypto from 'crypto'

interface GenerateOptions {
  applyTemplateChanges?: boolean
  skipExisting?: boolean
  startTime?: string
}

export interface GenerateResult {
  cycle_instance_id: string
  cycle_number: number
  start_date: string
  end_date: string
  visits_created: number
  crew_days_created: number
  addons_dropped_due_to_completion: number
}

// Supabase Postgres tops out around 65k parameters per insert; chunk
// into safer batches.
const INSERT_BATCH_SIZE = 500

export async function generateCycleInstance(
  db: SupabaseClient,
  templateId: string,
  startDate: string, // 'YYYY-MM-DD'
  cycleNumber: number,
  options: GenerateOptions = {}
): Promise<GenerateResult> {
  const { data: tpl, error: tplErr } = await db
    .from('routing_templates')
    .select('*')
    .eq('id', templateId)
    .single()
  if (tplErr || !tpl) throw new Error(`Template not found: ${tplErr?.message}`)
  const template = tpl as any

  const { data: existing } = await db
    .from('cycle_instances')
    .select('id, status')
    .eq('template_id', templateId)
    .eq('cycle_number', cycleNumber)
    .maybeSingle()

  if (existing && options.skipExisting) {
    return {
      cycle_instance_id: (existing as { id: string }).id,
      cycle_number: cycleNumber,
      start_date: startDate,
      end_date: addDays(startDate, template.cycle_length_days),
      visits_created: 0,
      crew_days_created: 0,
      addons_dropped_due_to_completion: 0,
    }
  }

  if (existing && options.applyTemplateChanges) {
    await db.from('scheduled_visits').delete().eq('cycle_instance_id', (existing as { id: string }).id)
    await db.from('crew_day_routes').delete().eq('cycle_instance_id', (existing as { id: string }).id)
  }

  const endDate = addDays(startDate, template.cycle_length_days)

  // Refresh cohort completion status: addons completed since template
  // was built shouldn't be re-attached to this cycle's visits.
  const trips = (template.trips ?? []) as any[]
  const cohortAssignmentIds = new Set<string>()
  for (const trip of trips) {
    for (const day of trip.days ?? []) {
      for (const stop of day.stops ?? []) {
        for (const addon of stop.attached_addons ?? []) {
          if (addon.cohort_assignment_id) cohortAssignmentIds.add(addon.cohort_assignment_id)
        }
      }
    }
  }
  const completedCohorts = new Set<string>()
  if (cohortAssignmentIds.size > 0) {
    const { data: cohortRows } = await db
      .from('addon_cohort_assignments')
      .select('id, last_completed_date, next_due_year')
      .in('id', Array.from(cohortAssignmentIds))
    const cycleYear = Number(startDate.slice(0, 4))
    for (const row of cohortRows ?? []) {
      const r = row as { id: string; last_completed_date: string | null; next_due_year: number }
      if (r.next_due_year > cycleYear) completedCohorts.add(r.id)
    }
  }

  // Insert (or refresh) the cycle_instance row.
  let cycleInstanceId: string
  if (existing) {
    cycleInstanceId = (existing as { id: string }).id
    await db
      .from('cycle_instances')
      .update({ start_date: startDate, end_date: endDate, generated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', cycleInstanceId)
  } else {
    const { data: inserted, error: insertErr } = await db
      .from('cycle_instances')
      .insert({
        template_id: templateId,
        cycle_number: cycleNumber,
        start_date: startDate,
        end_date: endDate,
        status: 'planned',
      })
      .select('id')
      .single()
    if (insertErr) throw new Error(`cycle_instances insert: ${insertErr.message}`)
    cycleInstanceId = (inserted as { id: string }).id
  }

  // Build all crew_day_routes + scheduled_visits in memory first,
  // pre-allocating UUIDs so visits can carry the crew_day_route_id.
  // Then bulk-insert in chunks. This drops the round-trip count from
  // O(trips × days) + O(days) to ~2 batches per table.
  const crewDayRoutes: any[] = []
  const scheduledVisits: any[] = []
  let addonsDropped = 0

  // Look up branch-prefixed crew labels (e.g. "Frisco TX Crew 1") from
  // the template; fall back to generic "Crew N" for older templates that
  // pre-date the labeling pass.
  const crewLabelByIndex = new Map<number, string>()
  for (const ca of (template.crew_assignments ?? []) as any[]) {
    if (typeof ca?.crew_index === 'number' && typeof ca?.crew_label === 'string') {
      crewLabelByIndex.set(ca.crew_index, ca.crew_label)
    }
  }

  for (const trip of trips) {
    for (const day of trip.days ?? []) {
      const dayOffset = (trip.relative_start_day ?? 0) + ((day.trip_day_number ?? 1) - 1)
      const scheduledDate = addDays(startDate, dayOffset)
      if (scheduledDate > endDate) continue

      const crewDayRouteId = crypto.randomUUID()
      crewDayRoutes.push({
        id: crewDayRouteId,
        cycle_instance_id: cycleInstanceId,
        template_id: templateId,
        trip_id: trip.trip_id,
        trip_label: trip.trip_label ?? trip.trip_id,
        crew_index: trip.crew_index ?? 0,
        crew_label: crewLabelByIndex.get(trip.crew_index ?? 0) ?? `Crew ${(trip.crew_index ?? 0) + 1}`,
        scheduled_date: scheduledDate,
        day_type: trip.trip_type === 'overnight' ? 'overnight' : 'local',
        start_location: trip.start_location ?? {},
        end_location: trip.end_location ?? null,
        route: day.stops ?? [],
        total_drive_minutes: day.summary?.total_drive_minutes ?? null,
        total_work_minutes: day.summary?.total_work_minutes ?? null,
        total_buffer_minutes: day.summary?.total_buffer_minutes ?? null,
        total_day_minutes: day.summary?.total_day_minutes ?? null,
        total_drive_miles: day.summary?.total_drive_miles ?? null,
        trip_day_number: day.trip_day_number ?? 1,
        trip_total_days: trip.duration_days ?? 1,
      })

      for (let i = 0; i < (day.stops ?? []).length; i++) {
        const stop = day.stops[i]
        const refreshedAddons: any[] = []
        for (const a of stop.attached_addons ?? []) {
          if (completedCohorts.has(a.cohort_assignment_id)) {
            addonsDropped++
            continue
          }
          refreshedAddons.push(a)
        }
        const baseHours = stop.hours_per_visit_base ?? 0
        const totalHours =
          baseHours + refreshedAddons.reduce((s, a) => s + (a.hours ?? 0), 0)

        scheduledVisits.push({
          cycle_instance_id: cycleInstanceId,
          template_id: templateId,
          service_location_id: stop.service_location_id,
          property_id: stop.property_id,
          parent_offering_id: stop.parent_offering_id ?? null,
          attached_addons: refreshedAddons,
          visit_number_in_cycle: stop.visit_number_in_cycle ?? 1,
          crew_day_route_id: crewDayRouteId,
          scheduled_date: scheduledDate,
          arrival_time: extractTime(stop.arrival_time),
          departure_time: extractTime(stop.departure_time),
          sequence_in_day: stop.sequence ?? i + 1,
          hours_per_visit_base: baseHours,
          hours_per_visit_total: totalHours,
          status: 'placed',
        })
      }
    }
  }

  // Surface unplaced visits as scheduled_visits with status='unplaced'.
  // Older templates (pre-fix) may be missing property_id on unplaced
  // entries; look them up from service_locations rather than fall back
  // to the SL id (which violates the property_id FK and rolls back the
  // entire batch insert via Postgres single-statement semantics).
  const unplacedRaw = (template.unplaced_visits ?? []) as any[]
  const slIdsNeedingPropId = unplacedRaw
    .filter((u) => u.service_location_id && !u.property_id)
    .map((u) => u.service_location_id as string)
  let propIdBySlId = new Map<string, string>()
  if (slIdsNeedingPropId.length > 0) {
    const { data: slRows } = await db
      .from('service_locations')
      .select('id, property_id')
      .in('id', slIdsNeedingPropId)
    propIdBySlId = new Map(
      (slRows ?? []).map((r) => [(r as any).id as string, (r as any).property_id as string])
    )
  }
  for (const u of unplacedRaw) {
    if (!u.service_location_id) continue
    const propertyId = u.property_id ?? propIdBySlId.get(u.service_location_id)
    if (!propertyId) {
      // Skip rather than break the whole batch with a bad FK.
      console.warn(
        `[generate-cycle] skipping unplaced visit for SL ${u.service_location_id}: no property_id resolvable`
      )
      continue
    }
    scheduledVisits.push({
      cycle_instance_id: cycleInstanceId,
      template_id: templateId,
      service_location_id: u.service_location_id,
      property_id: propertyId,
      visit_number_in_cycle: 1,
      status: 'unplaced',
      unplaced_reason: u.detail ?? u.reason,
      hours_per_visit_base: 0,
      hours_per_visit_total: 0,
    })
  }

  // Bulk-insert in chunks. THROW on failure rather than swallow — a
  // silent "generated cycle with 0 visits" is worse than a real error
  // because the user sees the cycle as successful and only later
  // notices the empty Gantt / map / list.
  let crewDaysCreated = 0
  for (let i = 0; i < crewDayRoutes.length; i += INSERT_BATCH_SIZE) {
    const chunk = crewDayRoutes.slice(i, i + INSERT_BATCH_SIZE)
    const { error } = await db.from('crew_day_routes').insert(chunk)
    if (error) {
      throw new Error(
        `crew_day_routes insert failed at batch ${i}-${i + chunk.length}: ${error.message}`
      )
    }
    crewDaysCreated += chunk.length
  }

  let visitsCreated = 0
  for (let i = 0; i < scheduledVisits.length; i += INSERT_BATCH_SIZE) {
    const chunk = scheduledVisits.slice(i, i + INSERT_BATCH_SIZE)
    const { error } = await db.from('scheduled_visits').insert(chunk)
    if (error) {
      throw new Error(
        `scheduled_visits insert failed at batch ${i}-${i + chunk.length}: ${error.message}`
      )
    }
    visitsCreated += chunk.length
  }

  return {
    cycle_instance_id: cycleInstanceId,
    cycle_number: cycleNumber,
    start_date: startDate,
    end_date: endDate,
    visits_created: visitsCreated,
    crew_days_created: crewDaysCreated,
    addons_dropped_due_to_completion: addonsDropped,
  }
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

function extractTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  if (iso.length >= 16 && iso.includes('T')) return iso.slice(11, 16)
  return iso
}
