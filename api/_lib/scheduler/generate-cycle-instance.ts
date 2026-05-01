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
import { haversineMiles, driveTimeMinutes } from '../analysis/haversine.js'

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

  // Visits whose mapped workday falls past cycle_end_date — typically
  // because Phase 4.4 pacing spread trips out and the last few workdays
  // landed in the next calendar month past the cycle horizon. We don't
  // silently drop these any more; capture them and insert as unplaced
  // rows further down so the cycle UI surfaces them.
  const overflowVisits: Array<{ stop: any; tripLabel: string; scheduledDate: string }> = []
  for (const trip of trips) {
    for (const day of trip.days ?? []) {
      // dayOffset is a working-day count (the routing engine sequences
      // trips back-to-back on workdays, not calendar days). crew-utilization
      // also bucketizes by workdays. Cycle gen previously used addDays
      // which counts calendar days, landing visits on Sat/Sun and creating
      // a mismatch between Calendar view (workday-bucketized) and List view
      // (raw DB rows).
      const dayOffset = (trip.relative_start_day ?? 0) + ((day.trip_day_number ?? 1) - 1)
      const scheduledDate = addWorkdays(startDate, dayOffset)
      if (scheduledDate > endDate) {
        for (const stop of day.stops ?? []) {
          overflowVisits.push({
            stop,
            tripLabel: trip.trip_label ?? trip.trip_id,
            scheduledDate,
          })
        }
        continue
      }

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

  // ── Build unified candidate list of unplaced visits ───────────────
  // We collect ALL unplaced candidates from BOTH sources (template-
  // build overflow + cycle-gen workday overflow) into one list, then
  // try gap-fill BEFORE deciding which become unplaced rows. The rule:
  // unplaced + idle days simultaneously is unacceptable. If a visit
  // can fit in an idle slot economically (drive + work fits the day),
  // it gets placed there.
  type UnplacedCandidate = {
    service_location_id: string
    property_id: string
    reason: string
    hours_base: number
    hours_total: number
    visit_number: number
  }
  const candidates: UnplacedCandidate[] = []

  for (const ov of overflowVisits) {
    if (!ov.stop?.property_id || !ov.stop?.service_location_id) continue
    const baseH = ov.stop.hours_per_visit_base ?? 0
    const addonH = (ov.stop.attached_addons ?? []).reduce(
      (s: number, a: any) => s + (a.hours ?? 0),
      0
    )
    candidates.push({
      service_location_id: ov.stop.service_location_id,
      property_id: ov.stop.property_id,
      reason: `Trip "${ov.tripLabel}" extended past cycle end (target workday mapped to ${ov.scheduledDate}).`,
      hours_base: baseH,
      hours_total: baseH + addonH,
      visit_number: ov.stop.visit_number_in_cycle ?? 1,
    })
  }

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
    if (!propertyId) continue
    candidates.push({
      service_location_id: u.service_location_id,
      property_id: propertyId,
      reason: u.detail ?? u.reason ?? 'unknown',
      hours_base: 0,
      hours_total: 0,
      visit_number: 1,
    })
  }

  // ── Gap-fill: assign each unplaced candidate to an idle workday ───
  // Look at every crew's idle workdays in this cycle. For each
  // candidate, find the (crew, day) pair that fits within work hours
  // (2 × drive + property work ≤ work_hours_per_day) and minimizes
  // drive cost. If found, schedule it. Otherwise the candidate stays
  // unplaced.
  const cfg = (template.config ?? {}) as Record<string, unknown>
  const driveSpeed = (cfg.drive_speed_mph as number) ?? 60
  const workHoursPerDay = (cfg.hours_per_day as number) ?? 10
  const workMinutesPerDay = workHoursPerDay * 60

  // Crew → branch coords. Pull from the first crew_day_route for that
  // crew (start_location). Falls back to cycle_instance_id's template
  // branches if no routes were created for that crew.
  const branchByCrewIdx = new Map<number, { lat: number; lng: number; name: string }>()
  for (const cd of crewDayRoutes) {
    if (branchByCrewIdx.has(cd.crew_index)) continue
    const sl = cd.start_location ?? null
    if (sl && typeof sl.lat === 'number' && typeof sl.lng === 'number') {
      branchByCrewIdx.set(cd.crew_index, {
        lat: sl.lat,
        lng: sl.lng,
        name: sl.name ?? `Crew ${cd.crew_index + 1}`,
      })
    }
  }
  // For crews with no routes at all (empty crews), use template branches
  // round-robin so they're still candidates for gap-fill.
  const tplBranches = (template.branches ?? []) as Array<{
    name?: string
    lat?: number
    lng?: number
  }>
  const declaredCrewCount = (template.crew_count as number) ?? branchByCrewIdx.size
  for (let i = 0; i < declaredCrewCount; i++) {
    if (branchByCrewIdx.has(i)) continue
    const b = tplBranches[i % Math.max(1, tplBranches.length)]
    if (b && typeof b.lat === 'number' && typeof b.lng === 'number') {
      branchByCrewIdx.set(i, { lat: b.lat, lng: b.lng, name: b.name ?? `Branch ${i}` })
    }
  }

  // Build the workday calendar (M-F) and idle day set per crew.
  const cycleStart = startDate
  const cycleEnd = endDate
  const workdays: string[] = []
  {
    const [y, m, d] = cycleStart.split('-').map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d))
    const [ey, em, ed] = cycleEnd.split('-').map(Number)
    const endDt = new Date(Date.UTC(ey, em - 1, ed))
    while (dt <= endDt) {
      const dow = dt.getUTCDay()
      if (dow !== 0 && dow !== 6) {
        workdays.push(dt.toISOString().slice(0, 10))
      }
      dt.setUTCDate(dt.getUTCDate() + 1)
    }
  }
  const usedByCrew = new Map<number, Set<string>>()
  for (const cd of crewDayRoutes) {
    const set = usedByCrew.get(cd.crew_index) ?? new Set<string>()
    set.add(cd.scheduled_date)
    usedByCrew.set(cd.crew_index, set)
  }
  const idleByCrew = new Map<number, string[]>()
  for (const idx of branchByCrewIdx.keys()) {
    const used = usedByCrew.get(idx) ?? new Set()
    idleByCrew.set(idx, workdays.filter((d) => !used.has(d)))
  }

  // Look up coords + addresses for candidates.
  let propsByIdMap = new Map<string, { lat: number | null; lng: number | null; address: string | null }>()
  if (candidates.length > 0) {
    const propIds = Array.from(new Set(candidates.map((c) => c.property_id)))
    for (let i = 0; i < propIds.length; i += 250) {
      const chunk = propIds.slice(i, i + 250)
      const { data } = await db
        .from('properties')
        .select('id, latitude, longitude, address_line1')
        .in('id', chunk)
      for (const r of (data ?? []) as any[]) {
        propsByIdMap.set(r.id, {
          lat: r.latitude,
          lng: r.longitude,
          address: r.address_line1,
        })
      }
    }
  }

  // Greedy gap-fill: for each candidate, find the (crew, day) that
  // minimizes total day minutes (2×drive + work). Reject slots that
  // don't fit in workMinutesPerDay.
  let gapFilled = 0
  let gapRejected = 0
  for (const cand of candidates) {
    const prop = propsByIdMap.get(cand.property_id)
    if (!prop || prop.lat == null || prop.lng == null) {
      // Can't gap-fill without coords — push as unplaced.
      scheduledVisits.push({
        cycle_instance_id: cycleInstanceId,
        template_id: templateId,
        service_location_id: cand.service_location_id,
        property_id: cand.property_id,
        visit_number_in_cycle: cand.visit_number,
        status: 'unplaced',
        unplaced_reason: cand.reason,
        hours_per_visit_base: cand.hours_base,
        hours_per_visit_total: cand.hours_total,
      })
      continue
    }

    const propWorkMin = Math.max(1, Math.round(cand.hours_total * 60))

    let best: {
      crewIdx: number
      branch: { lat: number; lng: number; name: string }
      date: string
      driveMin: number
      distMi: number
      totalMin: number
    } | null = null

    for (const [crewIdx, idleDays] of idleByCrew) {
      const branch = branchByCrewIdx.get(crewIdx)!
      const distMi = haversineMiles(
        { lat: prop.lat, lng: prop.lng },
        { lat: branch.lat, lng: branch.lng }
      )
      const driveMin = driveTimeMinutes(distMi, driveSpeed)
      const totalMin = 2 * driveMin + propWorkMin
      if (totalMin > workMinutesPerDay) continue
      if (idleDays.length === 0) continue
      // Earliest idle day on this crew is the cheapest slot for them.
      const date = idleDays[0]
      if (!best || totalMin < best.totalMin) {
        best = { crewIdx, branch, date, driveMin, distMi, totalMin }
      }
    }

    if (!best) {
      gapRejected++
      scheduledVisits.push({
        cycle_instance_id: cycleInstanceId,
        template_id: templateId,
        service_location_id: cand.service_location_id,
        property_id: cand.property_id,
        visit_number_in_cycle: cand.visit_number,
        status: 'unplaced',
        unplaced_reason:
          `${cand.reason} (Gap-fill checked all ${idleByCrew.size} crews and found no idle workday where 2×drive + work fits the ${workHoursPerDay}h day.)`,
        hours_per_visit_base: cand.hours_base,
        hours_per_visit_total: cand.hours_total,
      })
      continue
    }

    // Place it. Build a synthetic single-stop crew_day_route + a
    // status='placed' scheduled_visit. Mark the slot as used so a
    // subsequent candidate can't take the same day on the same crew.
    const newRouteId = crypto.randomUUID()
    const arrivalMin = 8 * 60 + best.driveMin // assume 08:00 start
    const departureMin = arrivalMin + propWorkMin
    const fmt = (mins: number) => {
      const h = Math.floor(mins / 60)
      const m = mins % 60
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    }

    // Round all minute fields — crew_day_routes integer columns reject
    // floats (e.g. driveTimeMinutes returns a real-valued estimate).
    const driveMinInt = Math.round(best.driveMin)
    const totalDriveMin = Math.round(2 * best.driveMin)
    const totalDayMin = Math.round(best.totalMin)
    crewDayRoutes.push({
      id: newRouteId,
      cycle_instance_id: cycleInstanceId,
      template_id: templateId,
      trip_id: `gapfill-${best.crewIdx}-${best.date}`,
      trip_label: `Gap-fill: ${prop.address ?? cand.property_id.slice(0, 8)}`,
      crew_index: best.crewIdx,
      crew_label: best.branch.name,
      scheduled_date: best.date,
      day_type: 'local',
      start_location: best.branch,
      end_location: best.branch,
      route: [
        {
          sequence: 1,
          service_location_id: cand.service_location_id,
          property_id: cand.property_id,
          address: prop.address ?? '',
          arrival_time: fmt(arrivalMin),
          departure_time: fmt(departureMin),
          drive_minutes_from_previous: driveMinInt,
          drive_distance_miles_from_previous: Math.round(best.distMi * 10) / 10,
          work_minutes: propWorkMin,
          constraint_violations: [],
        },
      ],
      total_drive_minutes: totalDriveMin,
      total_work_minutes: propWorkMin,
      total_buffer_minutes: 0,
      total_day_minutes: totalDayMin,
      total_drive_miles: Math.round(best.distMi * 2 * 10) / 10,
      trip_day_number: 1,
      trip_total_days: 1,
    })

    scheduledVisits.push({
      cycle_instance_id: cycleInstanceId,
      template_id: templateId,
      service_location_id: cand.service_location_id,
      property_id: cand.property_id,
      visit_number_in_cycle: cand.visit_number,
      crew_day_route_id: newRouteId,
      scheduled_date: best.date,
      arrival_time: fmt(arrivalMin),
      departure_time: fmt(departureMin),
      sequence_in_day: 1,
      hours_per_visit_base: cand.hours_base,
      hours_per_visit_total: cand.hours_total,
      status: 'placed',
    })

    // Consume this slot so the next candidate doesn't double-book it.
    const remaining = (idleByCrew.get(best.crewIdx) ?? []).filter((d) => d !== best.date)
    idleByCrew.set(best.crewIdx, remaining)
    gapFilled++
  }

  if (gapFilled > 0) {
    console.log(
      `[generate-cycle] gap-fill placed ${gapFilled} previously-unplaced visit(s) onto idle workdays; ${gapRejected} couldn't fit any idle slot.`
    )
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

// Advance N working days (Mon-Fri) from a YYYY-MM-DD date. If the start
// date itself is a weekend, rolls forward to the next Monday before
// counting workdays — so cycle gen never returns a weekend date.
function addWorkdays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  while (dt.getUTCDay() === 0 || dt.getUTCDay() === 6) {
    dt.setUTCDate(dt.getUTCDate() + 1)
  }
  let remaining = n
  while (remaining > 0) {
    dt.setUTCDate(dt.getUTCDate() + 1)
    const dow = dt.getUTCDay()
    if (dow !== 0 && dow !== 6) remaining--
  }
  return dt.toISOString().slice(0, 10)
}

function extractTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  if (iso.length >= 16 && iso.includes('T')) return iso.slice(11, 16)
  return iso
}
