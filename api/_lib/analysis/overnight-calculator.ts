// Phase 3.7 — Calculated overnight & hotel costs.
//
// Replaces the flat $35K hotels_annual constant with a calculation driven
// by which properties are >3hr from their assigned branch, geographically
// clustered into multi-night trips, with cost rolled up across all trips
// per year.
//
// Pure function. Caller provides properties (with hours_per_visit +
// visits_per_year), branches, and config. Returns total cost + per-trip
// breakdown.
import { haversineMiles, driveTimeMinutes, centroid, type LatLng } from './haversine.js'

export interface OvernightProperty {
  id: string
  address?: string | null
  lat: number
  lng: number
  visits_per_year: number
  hours_per_visit: number
}

export interface OvernightBranch {
  name: string
  lat: number
  lng: number
}

export interface OvernightConfig {
  drive_speed_mph: number
  overnight_trigger_one_way_hours: number
  max_work_hours_per_crew_day: number
  buffer_hours_per_day: number
  crew_size: number
  cost_per_night: number
  per_diem_per_night: number
  include_per_diem: boolean
}

export interface OvernightTrip {
  branch_name: string
  cluster_id: string
  cluster_centroid: LatLng
  properties_in_cluster: Array<{
    property_id: string
    address: string | null
    hours_per_visit: number
    visits_per_year: number
  }>
  drive_hours_one_way: number
  total_work_hours_per_visit: number
  work_days_per_trip: number
  nights_per_trip: number
  trips_per_year: number
  annual_nights: number
  annual_hotel_cost: number
  annual_per_diem_cost: number
  annual_total_cost: number
}

export interface OvernightResult {
  total_overnight_nights_per_year: number
  total_hotel_cost: number
  total_per_diem_cost: number
  total_overnight_cost: number
  trips: OvernightTrip[]
  day_trip_property_count: number
  avg_drive_hours_to_overnight_property: number
  largest_cluster_size: number
  properties_requiring_overnight: number
  config_used: OvernightConfig
}

const CLUSTER_RADIUS_MILES = 30

export function calculateOvernights(
  properties: OvernightProperty[],
  branches: OvernightBranch[],
  config: OvernightConfig
): OvernightResult {
  // Empty result for "no branches selected" — caller decides whether to
  // 400. We don't throw here because the dashboard wants to show this
  // section even when the calc isn't meaningful.
  if (branches.length === 0 || properties.length === 0) {
    return emptyResult(config)
  }

  // ── Step 1: Assign each property to its nearest branch + check trigger ──
  type Assigned = OvernightProperty & {
    branch_idx: number
    one_way_drive_hours: number
  }
  const assigned: Assigned[] = []
  for (const p of properties) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < branches.length; i++) {
      const d = haversineMiles({ lat: p.lat, lng: p.lng }, { lat: branches[i].lat, lng: branches[i].lng })
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
    const oneWayMin = driveTimeMinutes(bestDist, config.drive_speed_mph)
    assigned.push({
      ...p,
      branch_idx: bestIdx,
      one_way_drive_hours: oneWayMin / 60,
    })
  }

  const overnightProps = assigned.filter(
    (p) => p.one_way_drive_hours > config.overnight_trigger_one_way_hours
  )
  const dayTripCount = assigned.length - overnightProps.length

  if (overnightProps.length === 0) {
    return {
      ...emptyResult(config),
      day_trip_property_count: dayTripCount,
    }
  }

  // ── Step 2: Density-cluster overnight props within 30mi of each other ──
  // Group by branch first so a single trip is always from one branch — a
  // crew dispatched from Frisco to a Houston-area cluster wouldn't bundle
  // in a Lubbock property even if they're geographically adjacent.
  const byBranch = new Map<number, Assigned[]>()
  for (const p of overnightProps) {
    const arr = byBranch.get(p.branch_idx) ?? []
    arr.push(p)
    byBranch.set(p.branch_idx, arr)
  }

  const trips: OvernightTrip[] = []
  let totalDriveSum = 0
  let totalDriveCount = 0
  let largestCluster = 0

  for (const [branchIdx, props] of byBranch) {
    const clusters = densityCluster(props, CLUSTER_RADIUS_MILES)
    for (let ci = 0; ci < clusters.length; ci++) {
      const cluster = clusters[ci]
      if (cluster.length === 0) continue
      if (cluster.length > largestCluster) largestCluster = cluster.length

      const center = centroid(cluster.map((p) => ({ lat: p.lat, lng: p.lng })))
      // One-way drive from the branch to the cluster centroid (uses the same
      // drive_speed assumption as the rest of the system).
      const distToCenterMi = haversineMiles(
        { lat: branches[branchIdx].lat, lng: branches[branchIdx].lng },
        center
      )
      const driveHoursOneWay = driveTimeMinutes(distToCenterMi, config.drive_speed_mph) / 60

      // Work hours per single visit to the cluster = sum of hours_per_visit
      // across all properties in the cluster.
      const workHoursPerVisit = cluster.reduce((sum, p) => sum + p.hours_per_visit, 0)

      // Per-day work cap is the user's configured max (default 8 of 10).
      const workDaysPerTrip = Math.max(
        1,
        Math.ceil(workHoursPerVisit / config.max_work_hours_per_crew_day)
      )
      // Nights = work_days. Crew arrives the night before day 1, sleeps
      // night between each work day, drives home after the last work day.
      // (1 work day → 1 night; 3 work days → 3 nights.)
      const nightsPerTrip = workDaysPerTrip

      // Trips per year — operational simplification: max visits_per_year
      // across cluster props, with the lower-freq props bundled into the
      // higher-freq trip cadence.
      const tripsPerYear = cluster.reduce((m, p) => Math.max(m, p.visits_per_year), 0)
      const annualNights = nightsPerTrip * tripsPerYear

      const annualHotelCost = annualNights * config.cost_per_night
      const annualPerDiemCost = config.include_per_diem
        ? annualNights * config.per_diem_per_night * config.crew_size
        : 0

      for (const p of cluster) totalDriveSum += p.one_way_drive_hours
      totalDriveCount += cluster.length

      trips.push({
        branch_name: branches[branchIdx].name,
        cluster_id: `${branches[branchIdx].name}-c${ci}`,
        cluster_centroid: center,
        properties_in_cluster: cluster.map((p) => ({
          property_id: p.id,
          address: p.address ?? null,
          hours_per_visit: p.hours_per_visit,
          visits_per_year: p.visits_per_year,
        })),
        drive_hours_one_way: round2(driveHoursOneWay),
        total_work_hours_per_visit: round2(workHoursPerVisit),
        work_days_per_trip: workDaysPerTrip,
        nights_per_trip: nightsPerTrip,
        trips_per_year: tripsPerYear,
        annual_nights: annualNights,
        annual_hotel_cost: Math.round(annualHotelCost),
        annual_per_diem_cost: Math.round(annualPerDiemCost),
        annual_total_cost: Math.round(annualHotelCost + annualPerDiemCost),
      })
    }
  }

  const totalNights = trips.reduce((s, t) => s + t.annual_nights, 0)
  const totalHotelCost = trips.reduce((s, t) => s + t.annual_hotel_cost, 0)
  const totalPerDiemCost = trips.reduce((s, t) => s + t.annual_per_diem_cost, 0)
  const avgDriveHours =
    totalDriveCount > 0 ? round2(totalDriveSum / totalDriveCount) : 0

  return {
    total_overnight_nights_per_year: totalNights,
    total_hotel_cost: totalHotelCost,
    total_per_diem_cost: totalPerDiemCost,
    total_overnight_cost: totalHotelCost + totalPerDiemCost,
    trips,
    day_trip_property_count: dayTripCount,
    avg_drive_hours_to_overnight_property: avgDriveHours,
    largest_cluster_size: largestCluster,
    properties_requiring_overnight: overnightProps.length,
    config_used: config,
  }
}

function emptyResult(config: OvernightConfig): OvernightResult {
  return {
    total_overnight_nights_per_year: 0,
    total_hotel_cost: 0,
    total_per_diem_cost: 0,
    total_overnight_cost: 0,
    trips: [],
    day_trip_property_count: 0,
    avg_drive_hours_to_overnight_property: 0,
    largest_cluster_size: 0,
    properties_requiring_overnight: 0,
    config_used: config,
  }
}

// Density clustering — single-link agglomerative within a fixed radius.
// O(n²) pairwise distance check, fine for n in the hundreds. We don't
// reach for DBSCAN proper here because we don't need noise-point handling
// (every overnight prop belongs to some cluster, even if alone).
//
// Algorithm: each property starts in its own cluster. Repeatedly merge any
// two clusters where SOME property in one is within radius of SOME property
// in the other. Settles when no merges happen on a full pass.
function densityCluster<T extends { lat: number; lng: number }>(
  items: T[],
  radiusMiles: number
): T[][] {
  if (items.length === 0) return []
  const parent = items.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const d = haversineMiles(items[i], items[j])
      if (d <= radiusMiles) union(i, j)
    }
  }

  const groups = new Map<number, T[]>()
  for (let i = 0; i < items.length; i++) {
    const r = find(i)
    const arr = groups.get(r) ?? []
    arr.push(items[i])
    groups.set(r, arr)
  }
  return Array.from(groups.values())
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Resolves the final hotels_annual value used by Bid Pricing. Three cases:
//   1. Override is set → flat value, calc still computed for comparison
//   2. Calc has trips → use calculated total
//   3. Empty result → fall back to legacy flat hotels_annual
//
// The returned `breakdown` is what Bid Pricing surfaces in cost_buildup.hotels
// so the line-item expander can show the math (or the override + comparison).
export interface ResolvedHotelsCost {
  value: number
  basis: 'override' | 'calculated' | 'flat_fallback'
  hotel_room_cost: number
  per_diem_cost: number
  total_nights: number
  cost_per_night: number
  per_diem_per_night: number
  crew_size: number
  cluster_count: number
  properties_requiring_overnight: number
  // The full calc result, for the line-item drawer / Crew Strategy summary.
  calculated: OvernightResult
  // When basis === 'override', this is what the calc would have given.
  calculated_value: number
}

export function resolveHotelsCost(
  calc: OvernightResult,
  override: number | null,
  legacyFlat: number,
  config: OvernightConfig
): ResolvedHotelsCost {
  const calculatedValue = calc.total_overnight_cost
  let basis: ResolvedHotelsCost['basis']
  let value: number

  if (override != null) {
    basis = 'override'
    value = override
  } else if (calc.trips.length > 0) {
    basis = 'calculated'
    value = calculatedValue
  } else {
    basis = 'flat_fallback'
    value = legacyFlat
  }

  return {
    value,
    basis,
    hotel_room_cost: calc.total_hotel_cost,
    per_diem_cost: calc.total_per_diem_cost,
    total_nights: calc.total_overnight_nights_per_year,
    cost_per_night: config.cost_per_night,
    per_diem_per_night: config.per_diem_per_night,
    crew_size: config.crew_size,
    cluster_count: calc.trips.length,
    properties_requiring_overnight: calc.properties_requiring_overnight,
    calculated: calc,
    calculated_value: calculatedValue,
  }
}
