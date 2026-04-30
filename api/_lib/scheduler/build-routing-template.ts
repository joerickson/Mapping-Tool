// Phase 4d — pure template builder.
//
// Given routed properties + branches + crew_count + config, produces:
//   - cycle_length_days (from highest-frequency parent interval)
//   - clusters (local per-branch, remote density-clustered at 30mi)
//   - per-crew load-balanced assignment
//   - trips with relative_start_day in [0, cycle_length_days)
//   - per-day routes (calls Phase 4c routeDay() per day)
//   - cost rollup (drive + labor + overnight)
//   - optimization score
//
// No I/O. Caller loads data + persists the result.
import { haversineMiles, driveTimeMinutes, centroid } from '../analysis/haversine.js'
import { densityCluster, groupByNearestBranch } from './cluster.js'
import { computeCycleLength } from './cycle-length.js'
import { routeDay } from './route-day.js'
import {
  evaluateConstraint,
  type StoredConstraint,
} from './constraint-evaluator.js'

export interface PropertyForBuild {
  service_location_id: string
  property_id: string
  address: string
  lat: number
  lng: number
  parent_offering_id: string
  parent_offering_name: string
  parent_visit_interval_years: number
  base_hours_per_visit: number
  constraints: StoredConstraint[]
  eligible_addons: Array<{
    cohort_assignment_id: string
    offering_id: string
    offering_name: string
    visit_interval_years: number
    hours_addition: number
    cohort_index: number
    next_due_year: number
  }>
}

export interface BuildTemplateInput {
  account_id: string
  client_id: string
  routed_properties: PropertyForBuild[]
  branches: Array<{ name: string; lat: number; lng: number }>
  crew_count: number
  config: {
    crew_size: number
    hours_per_day: number
    work_start_time: string
    work_end_time: string
    buffer_minutes_per_stop: number
    drive_speed_mph: number
    overnight_trigger_one_way_hours: number
    cluster_radius_miles: number
    max_work_hours_per_crew_day: number
    fuel_cost_per_mile: number
    hourly_loaded_labor_cost: number
    cost_per_night: number
    per_diem_per_night: number
  }
  custom_cycle_length_days?: number
  preferences: {
    objective: 'minimize_drive' | 'maximize_utilization' | 'balanced'
    soft_constraint_weight: number
    allow_hard_constraint_violation: boolean
  }
  cycle_start_year: number
}

interface VisitSpec {
  service_location_id: string
  property_id: string
  parent_offering_id: string
  parent_offering_name: string
  visit_number_in_cycle: number
  visits_per_cycle: number
  base_hours: number
  attached_addons: Array<{
    offering_id: string
    offering_name: string
    hours: number
    cohort_assignment_id: string
    cohort_year: number
  }>
  hours_per_visit: number
  target_relative_day_window: [number, number]
  target_calendar_year: number
  lat: number
  lng: number
  constraints: StoredConstraint[]
  address: string
}

interface ClusterSpec {
  cluster_id: string
  cluster_type: 'local' | 'remote'
  base_branch_index: number
  centroid_lat: number
  centroid_lng: number
  visit_specs: VisitSpec[]
  total_work_hours: number
  estimated_drive_hours: number
  trips_per_cycle: number
  days_on_site_per_trip: number
}

export interface TemplateBuildResult {
  cycle_length_days: number
  cycle_length_label: string
  geographic_clusters: any[]
  crew_assignments: Array<{
    crew_index: number
    crew_label: string
    cluster_ids: string[]
    total_work_hours: number
    total_drive_hours: number
  }>
  trips: any[]
  unplaced_visits: any[]
  total_visits_required_per_cycle: number
  total_visits_per_cycle: number
  total_drive_minutes_per_cycle: number
  total_work_minutes_per_cycle: number
  total_overnight_nights_per_cycle: number
  total_drive_miles_per_cycle: number
  total_estimated_cost_per_cycle: number
  total_estimated_cost_per_year: number
  hard_constraint_violations: number
  soft_constraint_violations: number
  optimization_score: number
  optimizer_notes: string
}

const DAYS_PER_YEAR = 365

export function buildRoutingTemplate(input: BuildTemplateInput): TemplateBuildResult {
  // ── 1. Cycle length ───────────────────────────────────────────────
  const cycleResult = computeCycleLength(
    input.routed_properties.map((p) => ({
      service_location_id: p.service_location_id,
      parent_offering_visit_interval_years: p.parent_visit_interval_years,
    })),
    input.custom_cycle_length_days
  )
  const cycleDays = cycleResult.cycle_length_days

  // ── 2. Build visit specs (with addon attachment) ──────────────────
  const visitSpecs: VisitSpec[] = []
  let totalRequired = 0
  for (const p of input.routed_properties) {
    if (p.parent_visit_interval_years <= 0) continue
    const intervalDays = p.parent_visit_interval_years * DAYS_PER_YEAR
    if (intervalDays > cycleDays) {
      // Property visits less often than the cycle — skipped in this builder.
      // Cycle generator handles the parity case.
      continue
    }
    const visitsPerCycle = Math.max(1, Math.round(cycleDays / intervalDays))

    for (let visitIndex = 0; visitIndex < visitsPerCycle; visitIndex++) {
      totalRequired++
      const segmentSize = cycleDays / visitsPerCycle
      const targetMidpoint = segmentSize * (visitIndex + 0.5)
      const targetWindow: [number, number] = [
        Math.max(0, targetMidpoint - segmentSize / 4),
        Math.min(cycleDays, targetMidpoint + segmentSize / 4),
      ]
      const targetCalendarYear = input.cycle_start_year + Math.floor(targetMidpoint / DAYS_PER_YEAR)

      // Attach addons that are due in this calendar year and haven't been
      // attached to an earlier visit of the same property in this cycle.
      const attached: VisitSpec['attached_addons'] = []
      for (const addon of p.eligible_addons) {
        if (addon.next_due_year !== targetCalendarYear) continue
        const earlierSpec = visitSpecs.find(
          (v) =>
            v.service_location_id === p.service_location_id &&
            v.attached_addons.some((a) => a.offering_id === addon.offering_id)
        )
        if (earlierSpec) continue
        attached.push({
          offering_id: addon.offering_id,
          offering_name: addon.offering_name,
          hours: addon.hours_addition,
          cohort_assignment_id: addon.cohort_assignment_id,
          cohort_year: addon.next_due_year,
        })
      }
      const totalHours = p.base_hours_per_visit + attached.reduce((s, a) => s + a.hours, 0)

      visitSpecs.push({
        service_location_id: p.service_location_id,
        property_id: p.property_id,
        parent_offering_id: p.parent_offering_id,
        parent_offering_name: p.parent_offering_name,
        visit_number_in_cycle: visitIndex + 1,
        visits_per_cycle: visitsPerCycle,
        base_hours: p.base_hours_per_visit,
        attached_addons: attached,
        hours_per_visit: totalHours,
        target_relative_day_window: targetWindow,
        target_calendar_year: targetCalendarYear,
        lat: p.lat,
        lng: p.lng,
        constraints: p.constraints,
        address: p.address,
      })
    }
  }

  // ── 3. Geographic clustering ──────────────────────────────────────
  const overnightTriggerHours = input.config.overnight_trigger_one_way_hours
  const speed = input.config.drive_speed_mph

  const local: VisitSpec[] = []
  const remote: VisitSpec[] = []
  for (const v of visitSpecs) {
    if (input.branches.length === 0) {
      local.push(v)
      continue
    }
    let bestDist = Infinity
    for (const b of input.branches) {
      const d = haversineMiles({ lat: v.lat, lng: v.lng }, b)
      if (d < bestDist) bestDist = d
    }
    const hours = driveTimeMinutes(bestDist, speed) / 60
    if (hours > overnightTriggerHours) remote.push(v)
    else local.push(v)
  }

  const clusters: ClusterSpec[] = []
  // Local clusters: one per branch.
  if (local.length > 0 && input.branches.length > 0) {
    const grouped = groupByNearestBranch(local, input.branches)
    for (const [branchIdx, group] of grouped) {
      const c = centroid(group.map((v) => ({ lat: v.lat, lng: v.lng })))
      clusters.push(makeCluster(`local-${branchIdx}`, 'local', branchIdx, c, group, input))
    }
  } else if (local.length > 0) {
    const c = centroid(local.map((v) => ({ lat: v.lat, lng: v.lng })))
    clusters.push(makeCluster(`local-0`, 'local', 0, c, local, input))
  }

  // Remote clusters: density cluster at radius. Each goes to its own
  // nearest branch.
  if (remote.length > 0) {
    const grouped = densityCluster(remote, input.config.cluster_radius_miles)
    for (let gi = 0; gi < grouped.length; gi++) {
      const group = grouped[gi]
      const c = centroid(group.map((v) => ({ lat: v.lat, lng: v.lng })))
      let bestBranchIdx = 0
      let bestDist = Infinity
      for (let i = 0; i < input.branches.length; i++) {
        const d = haversineMiles(c, input.branches[i])
        if (d < bestDist) {
          bestDist = d
          bestBranchIdx = i
        }
      }
      clusters.push(makeCluster(`remote-${gi}`, 'remote', bestBranchIdx, c, group, input))
    }
  }

  // ── 4. Crew assignment (load balanced, descending sort) ───────────
  const crews = Array.from({ length: input.crew_count }, (_, i) => ({
    index: i,
    label: `Crew ${i + 1}`,
    cluster_ids: [] as string[],
    total_work_hours: 0,
    total_drive_hours: 0,
  }))
  const sorted = [...clusters].sort((a, b) => b.total_work_hours - a.total_work_hours)
  for (const cluster of sorted) {
    const target = crews.reduce((min, c) =>
      c.total_work_hours + c.total_drive_hours < min.total_work_hours + min.total_drive_hours ? c : min
    )
    target.cluster_ids.push(cluster.cluster_id)
    target.total_work_hours += cluster.total_work_hours
    target.total_drive_hours += cluster.estimated_drive_hours
  }

  // ── 5. Sequence trips on cycle calendar ───────────────────────────
  const trips: any[] = []
  const unplaced: any[] = []

  for (const crew of crews) {
    let nextAvailableDay = 0
    for (const clusterId of crew.cluster_ids) {
      const cluster = clusters.find((c) => c.cluster_id === clusterId)!
      for (let visitIdx = 0; visitIdx < cluster.trips_per_cycle; visitIdx++) {
        const tripDuration = cluster.cluster_type === 'remote' ? cluster.days_on_site_per_trip : 1
        const targetStart = Math.floor((cycleDays * (visitIdx + 0.5)) / cluster.trips_per_cycle)
        const tripStart = Math.max(targetStart, nextAvailableDay)

        // Build per-day routes via routeDay(). Visits eligible for THIS
        // visit_index of THIS cluster:
        const visitsForThisInstance = cluster.visit_specs.filter(
          (v) => v.visit_number_in_cycle === visitIdx + 1
        )

        if (visitsForThisInstance.length === 0) {
          continue
        }

        const baseBranch = input.branches[cluster.base_branch_index] ?? input.branches[0]
        const startLoc = { type: 'branch', name: baseBranch?.name ?? 'Branch', lat: baseBranch?.lat ?? 0, lng: baseBranch?.lng ?? 0 }

        // For multi-day trips, place all visits in a single day's routeDay
        // and let it overflow naturally. We simulate by calling routeDay
        // with hours_per_day = max_work_hours_per_crew_day * tripDuration —
        // but routeDay enforces work_end_time. Simpler: split visits across
        // days greedily.
        const days: any[] = []
        let remaining = [...visitsForThisInstance]
        let dayNumber = 1
        let dayStartLoc = startLoc

        while (remaining.length > 0 && dayNumber <= tripDuration) {
          const dayResult = routeDay({
            branch: { name: dayStartLoc.name, lat: dayStartLoc.lat, lng: dayStartLoc.lng },
            scheduled_date: '2026-01-01', // placeholder — only constraint date matters; cycle gen rewrites
            candidate_properties: remaining.map((v) => ({
              id: v.service_location_id,
              property_id: v.property_id,
              address: v.address,
              lat: v.lat,
              lng: v.lng,
              hours_per_visit: v.hours_per_visit,
              visits_per_year: 1,
              constraints: v.constraints,
            })),
            config: {
              crew_size: input.config.crew_size,
              hours_per_day: input.config.hours_per_day,
              work_start_time: input.config.work_start_time,
              work_end_time: input.config.work_end_time,
              buffer_minutes_per_stop: input.config.buffer_minutes_per_stop,
              drive_speed_mph: input.config.drive_speed_mph,
              return_to_branch: cluster.cluster_type === 'local' || dayNumber === tripDuration,
            },
            preferences: {
              objective: 'minimize_drive',
              soft_constraint_weight: input.preferences.soft_constraint_weight,
              allow_hard_constraint_violation: input.preferences.allow_hard_constraint_violation,
            },
          })

          if (dayResult.route.length === 0) break

          // Map each routed stop back to its visit_spec to attach addon info
          const stopsWithAddons = dayResult.route.map((stop) => {
            const spec = visitsForThisInstance.find(
              (v) => v.service_location_id === stop.service_location_id
            )
            return {
              ...stop,
              parent_offering_id: spec?.parent_offering_id,
              parent_offering_name: spec?.parent_offering_name,
              attached_addons: spec?.attached_addons ?? [],
              hours_per_visit_total: spec?.hours_per_visit ?? 0,
              hours_per_visit_base: spec?.base_hours ?? 0,
              visit_number_in_cycle: spec?.visit_number_in_cycle ?? 1,
              arrival_relative_minutes: minutesFromStart(stop.arrival_time, input.config.work_start_time),
              departure_relative_minutes: minutesFromStart(stop.departure_time, input.config.work_start_time),
            }
          })

          days.push({
            trip_day_number: dayNumber,
            stops: stopsWithAddons,
            summary: dayResult.summary,
          })

          // Subtract the placed visits from remaining
          const placedIds = new Set(dayResult.route.map((s) => s.service_location_id))
          remaining = remaining.filter((v) => !placedIds.has(v.service_location_id))

          // Day end → set next day's start to the last stop's lat/lng
          // (will be a hotel near the cluster centroid in reality — for
          // template purposes we use the last stop as the proxy origin
          // for day N+1).
          if (remaining.length > 0 && dayNumber < tripDuration) {
            const lastStop = stopsWithAddons[stopsWithAddons.length - 1]
            const lastSpec = visitsForThisInstance.find(
              (v) => v.service_location_id === lastStop.service_location_id
            )
            if (lastSpec) {
              dayStartLoc = {
                type: 'overnight_anchor',
                name: `Hotel near ${cluster.cluster_id}`,
                lat: cluster.centroid_lat,
                lng: cluster.centroid_lng,
              }
            }
          }

          dayNumber++
        }

        // Anything still in `remaining` couldn't fit
        for (const v of remaining) {
          unplaced.push({
            service_location_id: v.service_location_id,
            address: v.address,
            reason: 'time_overflow',
            detail: `Couldn't fit in ${tripDuration}-day trip for ${cluster.cluster_id} (visit ${visitIdx + 1}/${cluster.trips_per_cycle})`,
          })
        }

        if (days.length > 0) {
          trips.push({
            trip_id: `${cluster.cluster_id}-v${visitIdx + 1}`,
            crew_index: crew.index,
            cluster_id: cluster.cluster_id,
            trip_type: cluster.cluster_type === 'remote' ? 'overnight' : 'local',
            relative_start_day: tripStart,
            duration_days: days.length,
            start_location: startLoc,
            end_location: startLoc,
            days,
          })
          nextAvailableDay = tripStart + days.length
        }
      }
    }
  }

  // ── 6. Roll-up summary metrics ────────────────────────────────────
  let totalDriveMin = 0
  let totalWorkMin = 0
  let totalBufferMin = 0
  let totalDriveMiles = 0
  let totalNights = 0
  let totalVisitsPlaced = 0
  let hardViolations = 0
  let softViolations = 0

  for (const trip of trips) {
    if (trip.trip_type === 'overnight') totalNights += trip.duration_days
    for (const day of trip.days) {
      const s = day.summary
      totalDriveMin += s.total_drive_minutes
      totalWorkMin += s.total_work_minutes
      totalBufferMin += s.total_buffer_minutes
      totalDriveMiles += s.total_drive_miles
      hardViolations += s.hard_constraint_violations
      softViolations += s.soft_constraint_violations
      totalVisitsPlaced += day.stops.length
    }
  }

  const driveCost = totalDriveMiles * input.config.fuel_cost_per_mile
  const laborCost =
    (totalWorkMin / 60) * input.config.crew_size * input.config.hourly_loaded_labor_cost
  const overnightCost =
    totalNights * input.config.cost_per_night +
    totalNights * input.config.crew_size * input.config.per_diem_per_night
  const cycleCost = driveCost + laborCost + overnightCost
  const yearlyCost = cycleCost * (DAYS_PER_YEAR / cycleDays)

  // Score
  let score = 100
  score -= (totalRequired - totalVisitsPlaced) * 5
  score -= hardViolations * 25
  score -= softViolations * 3
  score = Math.max(0, Math.min(100, Math.round(score)))

  const notes: string[] = []
  if (totalRequired > totalVisitsPlaced) {
    notes.push(`${totalRequired - totalVisitsPlaced} visit(s) couldn't be placed.`)
  }
  if (totalNights > 0) {
    notes.push(`${totalNights} overnight nights/cycle across remote clusters.`)
  }

  return {
    cycle_length_days: cycleDays,
    cycle_length_label: cycleResult.cycle_length_label,
    geographic_clusters: clusters.map((c) => ({
      cluster_id: c.cluster_id,
      cluster_type: c.cluster_type,
      centroid_lat: c.centroid_lat,
      centroid_lng: c.centroid_lng,
      base_branch_index: c.base_branch_index,
      property_count: c.visit_specs.length,
      total_work_hours: c.total_work_hours,
      trips_per_cycle: c.trips_per_cycle,
      days_on_site_per_trip: c.days_on_site_per_trip,
    })),
    crew_assignments: crews.map((c) => ({
      crew_index: c.index,
      crew_label: c.label,
      cluster_ids: c.cluster_ids,
      total_work_hours: c.total_work_hours,
      total_drive_hours: c.total_drive_hours,
    })),
    trips,
    unplaced_visits: unplaced,
    total_visits_required_per_cycle: totalRequired,
    total_visits_per_cycle: totalVisitsPlaced,
    total_drive_minutes_per_cycle: Math.round(totalDriveMin),
    total_work_minutes_per_cycle: Math.round(totalWorkMin),
    total_overnight_nights_per_cycle: totalNights,
    total_drive_miles_per_cycle: Math.round(totalDriveMiles * 10) / 10,
    total_estimated_cost_per_cycle: Math.round(cycleCost),
    total_estimated_cost_per_year: Math.round(yearlyCost),
    hard_constraint_violations: hardViolations,
    soft_constraint_violations: softViolations,
    optimization_score: score,
    optimizer_notes: notes.join(' '),
  }
}

function makeCluster(
  cluster_id: string,
  cluster_type: 'local' | 'remote',
  base_branch_index: number,
  c: { lat: number; lng: number },
  visits: VisitSpec[],
  input: BuildTemplateInput
): ClusterSpec {
  const totalWork = visits.reduce((s, v) => s + v.hours_per_visit, 0)
  const tripsPerCycle = Math.max(1, Math.max(...visits.map((v) => v.visits_per_cycle)))
  const branch = input.branches[base_branch_index]
  const driveHours =
    branch != null
      ? driveTimeMinutes(haversineMiles(c, branch), input.config.drive_speed_mph) / 60
      : 0

  let daysOnSite = 1
  if (cluster_type === 'remote') {
    // Work hours per single visit (one trip of trips_per_cycle)
    const workPerTrip = totalWork / tripsPerCycle
    daysOnSite = Math.max(1, Math.ceil(workPerTrip / input.config.max_work_hours_per_crew_day))
  }

  return {
    cluster_id,
    cluster_type,
    base_branch_index,
    centroid_lat: c.lat,
    centroid_lng: c.lng,
    visit_specs: visits,
    total_work_hours: totalWork,
    estimated_drive_hours: driveHours * 2 * tripsPerCycle, // round trip per visit
    trips_per_cycle: tripsPerCycle,
    days_on_site_per_trip: daysOnSite,
  }
}

function minutesFromStart(iso: string, startHHMM: string): number {
  // iso looks like 'YYYY-MM-DDTHH:MM:00'; extract HH:MM portion.
  const time = iso.slice(11, 16)
  const [h, m] = time.split(':').map(Number)
  const [sh, sm] = startHHMM.split(':').map(Number)
  return h * 60 + m - (sh * 60 + sm)
}
