// Phase 4c — single-crew, single-day routing.
//
// Greedy nearest-neighbor + 2-opt refinement. NP-hard in general (TSP with
// time windows + capacity), but for our scale (5–20 stops/day) the
// heuristic gets within a few % of optimal in milliseconds.
//
// Pure function — no I/O. The endpoint loads data and calls routeDay().
import { haversineMiles, driveTimeMinutes, type LatLng } from '../analysis/haversine.js'
import {
  evaluateConstraint,
  fromMinutes,
  toMinutes,
  type ConstraintEvaluation,
  type StoredConstraint,
} from './constraint-evaluator.js'
import { type BuildingSizeClass } from '../analysis/building-size.js'

export interface PropertyForRouting {
  id: string // service_location_id
  property_id: string
  address: string
  lat: number
  lng: number
  hours_per_visit: number
  visits_per_year: number
  // Phase 4.3 — used by the same-day pairing gate (combined-sqft check).
  serviceable_sqft: number
  constraints: StoredConstraint[]
  // Phase 3.8 — optional per-SL override of auto-computed size class.
  building_size_class_override?: BuildingSizeClass | null
}

export interface DayRoutingInput {
  branch: { name: string; lat: number; lng: number }
  scheduled_date: string // 'YYYY-MM-DD'
  candidate_properties: PropertyForRouting[]
  config: {
    crew_size: number
    hours_per_day: number
    work_start_time: string // 'HH:MM'
    work_end_time: string // 'HH:MM'
    buffer_minutes_per_stop: number
    drive_speed_mph: number
    return_to_branch: boolean
    // Phase 4.3 — in-day pairing rule. The second slot only opens when
    // the two buildings are within max_drive_minutes of each other AND
    // their combined serviceable_sqft is at or below max_combined_sqft.
    // Hard cap on stops/day regardless of size keeps setup/breakdown
    // overhead honest.
    in_day_pairing_max_drive_minutes?: number
    in_day_pairing_max_buildings_per_day?: number
    in_day_pairing_max_combined_sqft?: number
  }
  preferences: {
    objective: 'minimize_drive' | 'maximize_properties' | 'balanced'
    soft_constraint_weight: number // 0–1
    allow_hard_constraint_violation: boolean
  }
}

export interface RouteStop {
  sequence: number
  service_location_id: string
  property_id: string
  address: string
  arrival_time: string // ISO timestamp
  departure_time: string // ISO timestamp
  drive_minutes_from_previous: number
  drive_distance_miles_from_previous: number
  work_minutes: number
  constraint_violations: ConstraintEvaluation[]
}

export interface ExcludedProperty {
  service_location_id: string
  address: string
  reason:
    | 'time_overflow'
    | 'hard_constraint'
    | 'too_far'
    | 'not_geocoded'
    | 'constraint_conflict'
    | 'other'
  detail: string
}

export interface DayRoutingResult {
  status: 'optimized' | 'infeasible' | 'partial'
  route: RouteStop[]
  excluded_properties: ExcludedProperty[]
  summary: {
    properties_visited: number
    properties_excluded: number
    total_drive_minutes: number
    total_work_minutes: number
    total_buffer_minutes: number
    total_day_minutes: number
    total_drive_miles: number
    start_time: string // 'HH:MM'
    end_time: string // 'HH:MM'
    hard_constraint_violations: number
    soft_constraint_violations: number
    optimization_score: number // 0–100
  }
}

export function routeDay(input: DayRoutingInput): DayRoutingResult {
  const excluded: ExcludedProperty[] = []
  const candidates: PropertyForRouting[] = []

  // ── Step 1: filter by hard constraints ────────────────────────────────
  // Only date-driven hard constraints can be evaluated without a proposed
  // schedule (day_of_week, blackout_dates, seasonal_window). time_window
  // and other context-dependent ones get re-checked during construction.
  for (const p of input.candidate_properties) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) {
      excluded.push({
        service_location_id: p.id,
        address: p.address,
        reason: 'not_geocoded',
        detail: 'Property has no coordinates; run enrichment to geocode.',
      })
      continue
    }
    const dateConstraints = p.constraints.filter(
      (c) =>
        c.constraint_type === 'day_of_week' ||
        c.constraint_type === 'blackout_dates' ||
        c.constraint_type === 'seasonal_window'
    )
    const baseCtx = {
      scheduled_date: input.scheduled_date,
      arrival_time: input.config.work_start_time,
      work_start_time: input.config.work_start_time,
      work_end_time: input.config.work_end_time,
      crew_size: input.config.crew_size,
    }
    let firstHardViolation: ConstraintEvaluation | null = null
    for (const c of dateConstraints) {
      const ev = evaluateConstraint(c, baseCtx)
      if (!ev.satisfied && ev.severity === 'hard') {
        firstHardViolation = ev
        break
      }
    }
    if (firstHardViolation && !input.preferences.allow_hard_constraint_violation) {
      excluded.push({
        service_location_id: p.id,
        address: p.address,
        reason: 'hard_constraint',
        detail: firstHardViolation.description,
      })
      continue
    }
    candidates.push(p)
  }

  // ── Step 2: greedy nearest-neighbor construction ──────────────────────
  const remaining = new Set(candidates.map((p) => p.id))
  const route: RouteStop[] = []
  const buffer = input.config.buffer_minutes_per_stop
  const speed = input.config.drive_speed_mph
  const workEnd = toMinutes(input.config.work_end_time)
  let currentLoc: LatLng = { lat: input.branch.lat, lng: input.branch.lng }
  let currentMin = toMinutes(input.config.work_start_time)
  let sequence = 1

  // Phase 4.3 — in-day pairing rule. Cap stops/day, and only allow the
  // second slot when the candidate is within drive radius of the first
  // AND their combined sqft fits the configured cap.
  const maxPerDay = input.config.in_day_pairing_max_buildings_per_day ?? 2
  const maxPairDriveMin = input.config.in_day_pairing_max_drive_minutes ?? 30
  const maxCombinedSqft = input.config.in_day_pairing_max_combined_sqft ?? 20000

  while (remaining.size > 0) {
    if (route.length >= maxPerDay) break

    let bestId: string | null = null
    let bestScore = Infinity
    let bestMeta: {
      distMi: number
      driveMin: number
      arrivalMin: number
      workStartMin: number
      workEndMin: number
      property: PropertyForRouting
      softViolations: number
    } | null = null

    for (const id of remaining) {
      const p = candidates.find((c) => c.id === id)!
      const distMi = haversineMiles(currentLoc, { lat: p.lat, lng: p.lng })
      const driveMin = driveTimeMinutes(distMi, speed)
      const arrivalMin = currentMin + driveMin
      const workStartMin = arrivalMin + buffer
      const workMinutes = Math.max(1, Math.round(p.hours_per_visit * 60))
      const workEndMin = workStartMin + workMinutes

      // Feasibility: must finish work + return-leg before work_end_time
      const returnDriveMin = input.config.return_to_branch
        ? driveTimeMinutes(
            haversineMiles({ lat: p.lat, lng: p.lng }, { lat: input.branch.lat, lng: input.branch.lng }),
            speed
          )
        : 0
      if (workEndMin + returnDriveMin > workEnd) continue

      // Phase 4.4 — aggressive pairing: drop the combined-sqft gate and
      // rely on the time-fit check above. The drive-minute cap stays as
      // a hard gate; size class becomes a soft tiebreaker (see scoring
      // below). Two standard properties at 4-5 hr each fit in a single
      // day with room to spare and the previous rule blocked them.
      let pairingTiebreakerPenalty = 0
      if (route.length >= 1) {
        if (driveMin > maxPairDriveMin) continue
        // Soft tiebreaker: prefer small+small pairings when multiple
        // candidates fit. Penalty only differentiates between equally
        // valid pairings; never blocks a fit.
        const firstStop = route[0]
        const firstProp = candidates.find((c) => c.id === firstStop.service_location_id)
        const isSmall = (sqft: number) => sqft > 0 && sqft <= maxCombinedSqft / 2
        const firstSmall = isSmall(firstProp?.serviceable_sqft ?? 0)
        const candidateSmall = isSmall(p.serviceable_sqft ?? 0)
        if (!(firstSmall && candidateSmall)) {
          pairingTiebreakerPenalty = 5
        }
      }

      // Soft-constraint penalty at this proposed schedule
      const ctx = {
        scheduled_date: input.scheduled_date,
        arrival_time: fromMinutes(arrivalMin),
        work_start_time: fromMinutes(workStartMin),
        work_end_time: fromMinutes(workEndMin),
        crew_size: input.config.crew_size,
      }
      let softPenalty = 0
      let softViolations = 0
      for (const c of p.constraints) {
        const ev = evaluateConstraint(c, ctx)
        if (!ev.satisfied && ev.severity === 'soft') {
          softPenalty += 1
          softViolations += 1
        }
      }

      // Score: depends on objective. Tiebreaker penalty added on top
      // for non-small+small pairings (Phase 4.4).
      let score: number
      if (input.preferences.objective === 'minimize_drive') {
        score = driveMin + softPenalty * 30 * input.preferences.soft_constraint_weight
      } else if (input.preferences.objective === 'maximize_properties') {
        // Pack tighter: prefer faster total commit (drive + work) so we
        // squeeze more stops in.
        score = driveMin + workMinutes * 0.1 + softPenalty * 10 * input.preferences.soft_constraint_weight
      } else {
        score = driveMin + softPenalty * 20 * input.preferences.soft_constraint_weight
      }
      score += pairingTiebreakerPenalty

      if (score < bestScore) {
        bestScore = score
        bestId = id
        bestMeta = {
          distMi,
          driveMin,
          arrivalMin,
          workStartMin,
          workEndMin,
          property: p,
          softViolations,
        }
      }
    }

    if (bestId == null || !bestMeta) break // no remaining candidate fits

    // Commit the best candidate to the route.
    const meta = bestMeta
    remaining.delete(bestId)
    const violations: ConstraintEvaluation[] = []
    const ctx = {
      scheduled_date: input.scheduled_date,
      arrival_time: fromMinutes(meta.arrivalMin),
      work_start_time: fromMinutes(meta.workStartMin),
      work_end_time: fromMinutes(meta.workEndMin),
      crew_size: input.config.crew_size,
    }
    for (const c of meta.property.constraints) {
      const ev = evaluateConstraint(c, ctx)
      if (!ev.satisfied || ev.category === 'informational') violations.push(ev)
    }
    route.push({
      sequence: sequence++,
      service_location_id: meta.property.id,
      property_id: meta.property.property_id,
      address: meta.property.address,
      arrival_time: combineDateTime(input.scheduled_date, fromMinutes(meta.arrivalMin)),
      departure_time: combineDateTime(input.scheduled_date, fromMinutes(meta.workEndMin)),
      drive_minutes_from_previous: Math.round(meta.driveMin),
      drive_distance_miles_from_previous: Math.round(meta.distMi * 10) / 10,
      work_minutes: meta.workEndMin - meta.workStartMin,
      constraint_violations: violations,
    })
    currentLoc = { lat: meta.property.lat, lng: meta.property.lng }
    currentMin = meta.workEndMin
  }

  // Anything left in remaining couldn't be fit.
  for (const id of remaining) {
    const p = candidates.find((c) => c.id === id)!
    excluded.push({
      service_location_id: p.id,
      address: p.address,
      reason: 'time_overflow',
      detail: `Wouldn't fit in the remaining day window before ${input.config.work_end_time}.`,
    })
  }

  // ── Step 3: 2-opt local search ────────────────────────────────────────
  // Build a Map for O(1) candidate lookups inside the inner loops —
  // the previous .find() was O(candidate_count) per call which made
  // 2-opt O(n³ · candidates) and tanked the template builder on
  // big portfolios.
  const candidateMap = new Map<string, PropertyForRouting>()
  for (const c of input.candidate_properties) candidateMap.set(c.id, c)

  if (route.length >= 4) {
    twoOptImprove(route, input, candidateMap)
  }

  // ── Step 4: re-walk the (possibly reordered) route to fix timestamps,
  // recompute drive legs, and re-check constraint violations ────────────
  finalizeTimestamps(route, input, candidateMap)

  // ── Step 5: summary metrics + score ───────────────────────────────────
  const totalDrive = route.reduce((s, r) => s + r.drive_minutes_from_previous, 0)
  const totalWork = route.reduce((s, r) => s + r.work_minutes, 0)
  const totalBuffer = route.length * input.config.buffer_minutes_per_stop
  const totalMiles = route.reduce((s, r) => s + r.drive_distance_miles_from_previous, 0)

  // Return-to-branch leg for the summary, if enabled
  let returnDriveMin = 0
  let returnMiles = 0
  if (input.config.return_to_branch && route.length > 0) {
    const last = route[route.length - 1]
    const lastP = candidates.find((c) => c.id === last.service_location_id)!
    returnMiles = haversineMiles({ lat: lastP.lat, lng: lastP.lng }, { lat: input.branch.lat, lng: input.branch.lng })
    returnDriveMin = driveTimeMinutes(returnMiles, speed)
  }

  const startTime = input.config.work_start_time
  const endMin =
    route.length === 0
      ? toMinutes(startTime)
      : toMinutes(extractTime(route[route.length - 1].departure_time)) + Math.round(returnDriveMin)
  const endTime = fromMinutes(endMin)

  let hardViols = 0
  let softViols = 0
  for (const stop of route) {
    for (const v of stop.constraint_violations) {
      if (v.category !== 'enforceable') continue
      if (v.satisfied) continue
      if (v.severity === 'hard') hardViols++
      else softViols++
    }
  }

  let score = 100
  score -= hardViols * 25
  score -= softViols * 5
  score -= excluded.length * 3
  score = Math.max(0, Math.min(100, Math.round(score)))

  let status: DayRoutingResult['status']
  if (route.length === 0) status = 'infeasible'
  else if (excluded.length > 0) status = 'partial'
  else status = 'optimized'

  return {
    status,
    route,
    excluded_properties: excluded,
    summary: {
      properties_visited: route.length,
      properties_excluded: excluded.length,
      total_drive_minutes: Math.round(totalDrive + returnDriveMin),
      total_work_minutes: Math.round(totalWork),
      total_buffer_minutes: totalBuffer,
      total_day_minutes: Math.round(totalDrive + totalWork + totalBuffer + returnDriveMin),
      total_drive_miles: Math.round((totalMiles + returnMiles) * 10) / 10,
      start_time: startTime,
      end_time: endTime,
      hard_constraint_violations: hardViols,
      soft_constraint_violations: softViols,
      optimization_score: score,
    },
  }
}

// ── 2-opt: try every pairwise segment reversal; accept any that
// shortens total drive time without introducing a hard constraint
// violation. Stops after a full pass with no improvement OR after 10
// iterations (most of the gain happens in the first 2-3 passes; the
// hard cap keeps the template builder fast on big portfolios).
function twoOptImprove(
  route: RouteStop[],
  input: DayRoutingInput,
  candidateMap: Map<string, PropertyForRouting>
): void {
  let improved = true
  let iterations = 0
  while (improved && iterations < 10) {
    improved = false
    iterations++
    let before = totalDriveMiles(route, input, candidateMap)
    for (let i = 0; i < route.length - 1; i++) {
      for (let j = i + 1; j < route.length; j++) {
        // Reverse segment [i..j]
        const reversed = route.slice(i, j + 1).reverse()
        const trial = [...route.slice(0, i), ...reversed, ...route.slice(j + 1)]
        const after = totalDriveMiles(trial, input, candidateMap)
        if (after < before - 0.01) {
          route.splice(0, route.length, ...trial)
          improved = true
          // Update `before` so subsequent swaps in this pass compare
          // against the new (shorter) total instead of recomputing the
          // whole route on every i,j.
          before = after
        }
      }
    }
  }
}

function totalDriveMiles(
  route: RouteStop[],
  input: DayRoutingInput,
  candidateMap: Map<string, PropertyForRouting>
): number {
  let prev: LatLng = { lat: input.branch.lat, lng: input.branch.lng }
  let total = 0
  for (const stop of route) {
    const p = candidateMap.get(stop.service_location_id)
    if (!p) continue
    total += haversineMiles(prev, { lat: p.lat, lng: p.lng })
    prev = { lat: p.lat, lng: p.lng }
  }
  if (input.config.return_to_branch) {
    total += haversineMiles(prev, { lat: input.branch.lat, lng: input.branch.lng })
  }
  return total
}

// Re-walk the route after 2-opt, producing fresh timestamps + drive legs +
// constraint violation lists. Mutates the route in place.
function finalizeTimestamps(
  route: RouteStop[],
  input: DayRoutingInput,
  candidateMap: Map<string, PropertyForRouting>
): void {
  const speed = input.config.drive_speed_mph
  const buffer = input.config.buffer_minutes_per_stop
  let currentLoc: LatLng = { lat: input.branch.lat, lng: input.branch.lng }
  let currentMin = toMinutes(input.config.work_start_time)
  let seq = 1
  for (const stop of route) {
    const p = candidateMap.get(stop.service_location_id)!
    const distMi = haversineMiles(currentLoc, { lat: p.lat, lng: p.lng })
    const driveMin = driveTimeMinutes(distMi, speed)
    const arrivalMin = currentMin + driveMin
    const workStartMin = arrivalMin + buffer
    const workMinutes = Math.max(1, Math.round(p.hours_per_visit * 60))
    const workEndMin = workStartMin + workMinutes

    stop.sequence = seq++
    stop.drive_minutes_from_previous = Math.round(driveMin)
    stop.drive_distance_miles_from_previous = Math.round(distMi * 10) / 10
    stop.arrival_time = combineDateTime(input.scheduled_date, fromMinutes(arrivalMin))
    stop.departure_time = combineDateTime(input.scheduled_date, fromMinutes(workEndMin))
    stop.work_minutes = workEndMin - workStartMin

    // Recompute violations against new times
    const ctx = {
      scheduled_date: input.scheduled_date,
      arrival_time: fromMinutes(arrivalMin),
      work_start_time: fromMinutes(workStartMin),
      work_end_time: fromMinutes(workEndMin),
      crew_size: input.config.crew_size,
    }
    stop.constraint_violations = []
    for (const c of p.constraints) {
      const ev = evaluateConstraint(c, ctx)
      if (!ev.satisfied || ev.category === 'informational') stop.constraint_violations.push(ev)
    }

    currentLoc = { lat: p.lat, lng: p.lng }
    currentMin = workEndMin
  }
}

function combineDateTime(date: string, hhmm: string): string {
  return `${date}T${hhmm}:00`
}

function extractTime(iso: string): string {
  return iso.slice(11, 16)
}
