// Phase 3.7 — Calculated overnight & hotel costs.
// Phase 4.1 — Per-cluster overrides + borderline detection +
//             stable cluster IDs + calculation_text.
//
// Replaces the flat $35K hotels_annual constant with a calculation driven
// by which properties are >3hr from their assigned branch, geographically
// clustered into multi-night trips, with cost rolled up across all trips
// per year.
//
// Pure function. Caller provides properties (with hours_per_visit +
// visits_per_year), branches, config, and optional per-cluster overrides
// loaded from `overnight_cluster_overrides`. Returns total cost +
// per-trip breakdown including override status and a human-readable
// calculation_text the UI can render verbatim.
import { haversineMiles, driveTimeMinutes, centroid, type LatLng } from './haversine.js'
import { computeClusterId } from './cluster-id.js'

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

export interface OvernightClusterOverride {
  nights_per_trip_override?: number | null
  trips_per_year_override?: number | null
  cost_per_night_override?: number | null
  per_diem_per_night_override?: number | null
  skip_overnight?: boolean | null
  skip_overnight_reason?: string | null
}

export interface OvernightTrip {
  branch_name: string
  // Stable id: sha256 prefix of sorted property_ids in this cluster.
  // Survives re-runs as long as the same set of properties cluster
  // together; changes if a property is added or removed.
  cluster_id: string
  cluster_label: string
  cluster_centroid: LatLng
  properties_in_cluster: Array<{
    property_id: string
    address: string | null
    hours_per_visit: number
    visits_per_year: number
  }>
  drive_hours_one_way: number
  drive_distance_miles_one_way: number
  total_work_hours_per_visit: number
  work_days_per_trip: number

  // Calculated values (algorithm output).
  nights_per_trip_calculated: number
  trips_per_year_calculated: number
  cost_per_night_default: number
  per_diem_per_night_default: number

  // Used values (= calculated unless override applied).
  nights_per_trip: number
  trips_per_year: number
  cost_per_night_used: number
  per_diem_per_night_used: number

  annual_nights: number
  annual_hotel_cost: number
  annual_per_diem_cost: number
  annual_total_cost: number

  // Phase 4.1 flags.
  is_borderline: boolean
  borderline_reason: string | null
  has_overrides: boolean
  override_fields: string[]
  is_skipped: boolean
  skip_reason: string | null

  calculation_text: string
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
  // Phase 4.1 — aggregate counts surfaced in summary card.
  cluster_count: number
  cluster_count_with_overrides: number
  cluster_count_skipped: number
  cluster_count_borderline: number
  // Cluster IDs from the saved override table that no longer match any
  // current cluster (usually because property contents shifted). UI can
  // surface these as "stale, review or clear".
  stale_override_cluster_ids: string[]
  config_used: OvernightConfig
}

// Borderline drive window — clusters in this range are still treated as
// overnight by the algorithm but flagged so users can review whether a
// crew could realistically handle it as a long day trip.
const BORDERLINE_DRIVE_HOURS_LOWER = 3.0
const BORDERLINE_DRIVE_HOURS_UPPER = 3.5

const CLUSTER_RADIUS_MILES = 30

export function calculateOvernights(
  properties: OvernightProperty[],
  branches: OvernightBranch[],
  config: OvernightConfig,
  clusterOverrides: Record<string, OvernightClusterOverride> = {}
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

  const matchedOverrideIds = new Set<string>()

  for (const [branchIdx, props] of byBranch) {
    const clusters = densityCluster(props, CLUSTER_RADIUS_MILES)
    for (let ci = 0; ci < clusters.length; ci++) {
      const cluster = clusters[ci]
      if (cluster.length === 0) continue
      if (cluster.length > largestCluster) largestCluster = cluster.length

      const center = centroid(cluster.map((p) => ({ lat: p.lat, lng: p.lng })))
      const distToCenterMi = haversineMiles(
        { lat: branches[branchIdx].lat, lng: branches[branchIdx].lng },
        center
      )
      const driveHoursOneWay = driveTimeMinutes(distToCenterMi, config.drive_speed_mph) / 60

      const workHoursPerVisit = cluster.reduce((sum, p) => sum + p.hours_per_visit, 0)

      const workDaysPerTrip = Math.max(
        1,
        Math.ceil(workHoursPerVisit / config.max_work_hours_per_crew_day)
      )
      // Nights = work_days. Crew arrives the night before day 1, sleeps
      // night between each work day, drives home after the last work day.
      const nightsPerTripCalc = workDaysPerTrip
      const tripsPerYearCalc = cluster.reduce((m, p) => Math.max(m, p.visits_per_year), 0)

      // Stable cluster id from sorted property IDs in this cluster.
      const clusterId = computeClusterId(cluster.map((p) => p.id))
      const clusterLabel = labelForCluster(cluster, branches[branchIdx].name)
      const ovr = clusterOverrides[clusterId]
      if (ovr) matchedOverrideIds.add(clusterId)

      // Apply overrides. null/undefined fields fall through to calculated.
      const isSkipped = !!ovr?.skip_overnight
      const nightsPerTripUsed = isSkipped
        ? 0
        : ovr?.nights_per_trip_override != null
          ? ovr.nights_per_trip_override
          : nightsPerTripCalc
      const tripsPerYearUsed = isSkipped
        ? 0
        : ovr?.trips_per_year_override != null
          ? ovr.trips_per_year_override
          : tripsPerYearCalc
      const costPerNightUsed =
        ovr?.cost_per_night_override != null
          ? ovr.cost_per_night_override
          : config.cost_per_night
      const perDiemPerNightUsed =
        ovr?.per_diem_per_night_override != null
          ? ovr.per_diem_per_night_override
          : config.per_diem_per_night

      const annualNights = nightsPerTripUsed * tripsPerYearUsed
      const annualHotelCost = annualNights * costPerNightUsed
      const annualPerDiemCost = config.include_per_diem
        ? annualNights * perDiemPerNightUsed * config.crew_size
        : 0

      // Borderline detection: drive in the 3.0–3.5 hr window AND not
      // explicitly marked as a day trip. Skipped clusters aren't
      // "borderline" — the user already decided.
      const isBorderline =
        !isSkipped &&
        driveHoursOneWay >= BORDERLINE_DRIVE_HOURS_LOWER &&
        driveHoursOneWay <= BORDERLINE_DRIVE_HOURS_UPPER
      const borderlineReason = isBorderline
        ? `${round2(driveHoursOneWay)} hours one-way — close to overnight threshold; consider whether crew can do day trip`
        : null

      // Override status — list which fields the user actually overrode
      // (excluding "skip" which has its own flag).
      const overrideFields: string[] = []
      if (ovr?.nights_per_trip_override != null) overrideFields.push('nights_per_trip')
      if (ovr?.trips_per_year_override != null) overrideFields.push('trips_per_year')
      if (ovr?.cost_per_night_override != null) overrideFields.push('cost_per_night')
      if (ovr?.per_diem_per_night_override != null) overrideFields.push('per_diem_per_night')

      for (const p of cluster) totalDriveSum += p.one_way_drive_hours
      totalDriveCount += cluster.length

      const calculationText = buildCalculationText({
        isSkipped,
        skipReason: ovr?.skip_overnight_reason ?? null,
        nightsCalc: nightsPerTripCalc,
        nightsUsed: nightsPerTripUsed,
        tripsCalc: tripsPerYearCalc,
        tripsUsed: tripsPerYearUsed,
        costPerNightDefault: config.cost_per_night,
        costPerNightUsed,
        perDiemDefault: config.per_diem_per_night,
        perDiemUsed: perDiemPerNightUsed,
        crewSize: config.crew_size,
        includePerDiem: config.include_per_diem,
        annualHotelCost,
        annualPerDiemCost,
        overrideFields,
      })

      trips.push({
        branch_name: branches[branchIdx].name,
        cluster_id: clusterId,
        cluster_label: clusterLabel,
        cluster_centroid: center,
        properties_in_cluster: cluster.map((p) => ({
          property_id: p.id,
          address: p.address ?? null,
          hours_per_visit: p.hours_per_visit,
          visits_per_year: p.visits_per_year,
        })),
        drive_hours_one_way: round2(driveHoursOneWay),
        drive_distance_miles_one_way: Math.round(distToCenterMi),
        total_work_hours_per_visit: round2(workHoursPerVisit),
        work_days_per_trip: workDaysPerTrip,
        nights_per_trip_calculated: nightsPerTripCalc,
        trips_per_year_calculated: tripsPerYearCalc,
        cost_per_night_default: config.cost_per_night,
        per_diem_per_night_default: config.per_diem_per_night,
        nights_per_trip: nightsPerTripUsed,
        trips_per_year: tripsPerYearUsed,
        cost_per_night_used: costPerNightUsed,
        per_diem_per_night_used: perDiemPerNightUsed,
        annual_nights: annualNights,
        annual_hotel_cost: Math.round(annualHotelCost),
        annual_per_diem_cost: Math.round(annualPerDiemCost),
        annual_total_cost: Math.round(annualHotelCost + annualPerDiemCost),
        is_borderline: isBorderline,
        borderline_reason: borderlineReason,
        has_overrides: overrideFields.length > 0,
        override_fields: overrideFields,
        is_skipped: isSkipped,
        skip_reason: ovr?.skip_overnight_reason ?? null,
        calculation_text: calculationText,
      })
    }
  }

  // Stale overrides — cluster IDs in the table that don't match any
  // current cluster. Surface for UI cleanup.
  const staleOverrideClusterIds = Object.keys(clusterOverrides).filter(
    (id) => !matchedOverrideIds.has(id)
  )

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
    cluster_count: trips.length,
    cluster_count_with_overrides: trips.filter((t) => t.has_overrides || t.is_skipped).length,
    cluster_count_skipped: trips.filter((t) => t.is_skipped).length,
    cluster_count_borderline: trips.filter((t) => t.is_borderline).length,
    stale_override_cluster_ids: staleOverrideClusterIds,
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
    cluster_count: 0,
    cluster_count_with_overrides: 0,
    cluster_count_skipped: 0,
    cluster_count_borderline: 0,
    stale_override_cluster_ids: [],
    config_used: config,
  }
}

// Generate a human-readable label for the cluster: "Cluster of N
// properties near {first address}". The address comes from the property
// closest to the centroid (rough proxy for "city" without a city/state
// field on the input). Saved to DB on override and shown in UI; doesn't
// participate in the stable cluster_id hash.
function labelForCluster(
  cluster: Array<OvernightProperty & { lat: number; lng: number }>,
  branchName: string
): string {
  if (cluster.length === 0) return `Cluster from ${branchName}`
  const center = centroid(cluster.map((p) => ({ lat: p.lat, lng: p.lng })))
  let nearest = cluster[0]
  let nearestDist = Infinity
  for (const p of cluster) {
    const d = haversineMiles(center, { lat: p.lat, lng: p.lng })
    if (d < nearestDist) {
      nearestDist = d
      nearest = p
    }
  }
  const addr = nearest.address?.trim() || `${nearest.lat.toFixed(2)}, ${nearest.lng.toFixed(2)}`
  const short = addr.length > 50 ? addr.slice(0, 47) + '…' : addr
  return `${cluster.length} ${cluster.length === 1 ? 'property' : 'properties'} near ${short}`
}

function buildCalculationText(args: {
  isSkipped: boolean
  skipReason: string | null
  nightsCalc: number
  nightsUsed: number
  tripsCalc: number
  tripsUsed: number
  costPerNightDefault: number
  costPerNightUsed: number
  perDiemDefault: number
  perDiemUsed: number
  crewSize: number
  includePerDiem: boolean
  annualHotelCost: number
  annualPerDiemCost: number
  overrideFields: string[]
}): string {
  if (args.isSkipped) {
    const reason = args.skipReason ? ` Reason: ${args.skipReason}` : ''
    return `Marked as day-trip (no overnight) — costs set to $0.${reason}`
  }
  const annualNights = args.nightsUsed * args.tripsUsed
  const overridden = args.overrideFields.length > 0
  const prefix = overridden ? '**Overridden:** ' : ''
  const nightsBit =
    args.nightsUsed === args.nightsCalc
      ? `${args.nightsUsed} nights/trip`
      : `${args.nightsUsed} nights/trip (was ${args.nightsCalc})`
  const tripsBit =
    args.tripsUsed === args.tripsCalc
      ? `${args.tripsUsed} trips/yr`
      : `${args.tripsUsed} trips/yr (was ${args.tripsCalc})`
  const costBit =
    args.costPerNightUsed === args.costPerNightDefault
      ? `$${args.costPerNightUsed}/night`
      : `$${args.costPerNightUsed}/night (was $${args.costPerNightDefault})`
  const perDiemBit =
    args.perDiemUsed === args.perDiemDefault
      ? `$${args.perDiemUsed}/diem`
      : `$${args.perDiemUsed}/diem (was $${args.perDiemDefault})`
  const hotelLine = `Hotel: ${nightsBit} × ${tripsBit} × ${costBit} = $${Math.round(args.annualHotelCost).toLocaleString()}`
  const perDiemLine = args.includePerDiem
    ? `Per diem: ${annualNights} nights × ${args.crewSize} crew × ${perDiemBit} = $${Math.round(args.annualPerDiemCost).toLocaleString()}`
    : 'Per diem: not included'
  const total = `Total: $${Math.round(args.annualHotelCost + args.annualPerDiemCost).toLocaleString()}`
  return `${prefix}${hotelLine}; ${perDiemLine}; ${total}`
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
