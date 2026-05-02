// POST /api/analyses/[accountId]/branch-optimization
// k-means over property coordinates for k = k_range[0]..k_range[1]; returns
// per-k cost breakdown (drive cost + fixed branch cost), recommended elbow,
// and reverse-geocoded city names for each centroid.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../../../_lib/supabase.js'
import { authenticateRequest } from '../../../../../_lib/auth.js'
import {
  loadAccountProperties,
  createAnalysisRecord,
  completeAnalysisRecord,
  failAnalysisRecord,
  hashInputs,
  type AccountProperty,
} from '../../../../../_lib/analysis/account-data.js'
import { haversineMiles, driveTimeMinutes, type LatLng } from '../../../../../_lib/analysis/haversine.js'
import { kmeans } from '../../../../../_lib/analysis/kmeans.js'
import { reverseGeocodeCityState } from '../../../../../_lib/analysis/reverse-geocode.js'
import {
  loadConstraints,
  applyExclusions,
  type ExistingBranch,
} from '../../../../../_lib/analysis/operational-constraints.js'
import {
  constrainedKMeans,
  nearestCity,
  populationBand,
  type City,
} from '../../../../../_lib/analysis/constrained-kmeans.js'

export interface BranchOptInputs {
  client_id?: string | null
  k_range: [number, number]
  drive_speed_mph: number
  hourly_labor_cost: number
  fuel_cost_per_mile: number
  fixed_branch_cost_annual: number
  existing_branches: ExistingBranch[]
  population_constraint: {
    enabled: boolean
    min_population: number
    max_population?: number | null
    state_filter?: string[] | null
  }
}

const DEFAULT_VISITS_PER_YEAR = 4

// k-means + 7 reverse-geocode calls fits comfortably in 60s for 524 properties.
export const config = { maxDuration: 60 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let ctx: Awaited<ReturnType<typeof authenticateRequest>>
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const accountId = req.query.accountId as string
  const clientId = req.query.clientId as string
  const body = (req.body ?? {}) as Partial<BranchOptInputs>

  const db = createAdminClient()
  const constraints = await loadConstraints(db, accountId, clientId)

  const inputs: BranchOptInputs = {
    client_id: clientId,
    k_range: body.k_range ?? [1, 7],
    drive_speed_mph: body.drive_speed_mph ?? constraints.drive_speed_mph,
    hourly_labor_cost: body.hourly_labor_cost ?? constraints.hourly_loaded_labor_cost,
    fuel_cost_per_mile: body.fuel_cost_per_mile ?? constraints.fuel_cost_per_mile,
    fixed_branch_cost_annual: body.fixed_branch_cost_annual ?? constraints.branch_overhead_annual,
    existing_branches: body.existing_branches ?? constraints.existing_branches ?? [],
    population_constraint:
      (body as any).population_constraint ?? constraints.population_constraint,
  }

  // Soft-adjust: k_range can't drop below the existing branch count
  // (the optimizer can't suggest removing branches the operator has
  // committed to). If the request asks for a k_min below existing,
  // silently bump both bounds up so the optimizer still runs and
  // surface a note in the summary text. Was previously a hard 400 —
  // failing the analysis blocked the user from seeing the rest of
  // the recommendation.
  const existingN = inputs.existing_branches.length
  let adjustmentNote: string | null = null
  if (existingN > 0) {
    const [origMin, origMax] = inputs.k_range
    if (origMin < existingN) {
      const newMax = Math.max(existingN, origMax)
      inputs.k_range = [existingN, newMax]
      adjustmentNote =
        `Bumped k floor from ${origMin} to ${existingN} to honor your ${existingN} existing branch(es). ` +
        `The optimizer can suggest adding branches but cannot drop any that are already committed.` +
        (newMax !== origMax
          ? ` Bumped ceiling from ${origMax} to ${newMax} to keep at least one scenario in scope.`
          : '')
    }
  }

  // Cache: if a completed run exists with the same inputs hash for this
  // account, return it. CACHE_VERSION is mixed into the hash so any change to
  // the analysis output shape (e.g. reverse-geocoding logic, or constraints
  // wiring) invalidates existing rows. Bump it whenever the output of
  // computeBranchOptimization would differ for the same inputs.
  const CACHE_VERSION = 4
  const cacheKey = hashInputs({
    accountId,
    clientId,
    _v: CACHE_VERSION,
    ...inputs,
    _excluded: constraints.excluded_property_ids,
  })
  const cached = await db
    .from('portfolio_analyses')
    .select('id, inputs')
    .eq('account_id', accountId)
    .eq('client_id', clientId)
    .eq('module_key', 'branch_optimization')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(20)

  if (cached.data) {
    const hit = cached.data.find((r: any) => r.inputs?._cache_key === cacheKey)
    if (hit) {
      return res.status(200).json({ analysis_id: (hit as any).id, status: 'completed', cached: true })
    }
  }

  let analysisId: string
  try {
    analysisId = await createAnalysisRecord(db, {
      account_id: accountId,
      client_id: clientId,
      module_key: 'branch_optimization',
      inputs: { ...inputs, _cache_key: cacheKey },
      created_by: ctx.userId ?? null,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message ?? 'Failed to create analysis record' })
  }

  try {
    const allProperties = await loadAccountProperties(db, accountId, clientId)
    const properties = applyExclusions(allProperties, constraints.excluded_property_ids)
    const result = await computeBranchOptimization(properties, inputs)
    const summaryWithNote = adjustmentNote
      ? `${adjustmentNote} ${result.summary_text}`
      : result.summary_text
    await completeAnalysisRecord(db, analysisId, {
      outputs: { ...result.outputs, k_floor_adjusted: adjustmentNote },
      summary_text: summaryWithNote,
      property_count: properties.length,
    })
    return res.status(200).json({ analysis_id: analysisId, status: 'completed' })
  } catch (err: any) {
    const msg = err?.message ?? String(err)
    await failAnalysisRecord(db, analysisId, msg)
    return res.status(500).json({ analysis_id: analysisId, status: 'failed', error: msg })
  }
}

export async function computeBranchOptimization(
  properties: AccountProperty[],
  inputs: BranchOptInputs
) {
  const withCoords = properties.filter((p) => p.latitude != null && p.longitude != null)
  const points: LatLng[] = withCoords.map((p) => ({ lat: p.latitude!, lng: p.longitude! }))

  if (points.length === 0) {
    return {
      outputs: { property_count: 0, k_results: [], recommended_k: 0, missing_coords_count: properties.length },
      summary_text: 'No properties have coordinates — branch optimization cannot run. Geocode the portfolio first.',
    }
  }

  const lockedCentroids: LatLng[] = inputs.existing_branches.map((b) => ({
    lat: b.lat,
    lng: b.lng,
  }))
  const floorK = lockedCentroids.length

  const [kMin, kMax] = inputs.k_range
  const kStart = Math.max(1, floorK, Math.min(kMin, kMax))
  const kEnd = Math.max(kStart, Math.min(kMax, points.length))

  // ── Population-constrained path ────────────────────────────────────────
  // When the constraint is enabled we pick centers from real US cities that
  // meet the population threshold. Each constrained run yields named cities,
  // so we don't need the reverse-geocoder for primary output.
  const popEnabled = !!inputs.population_constraint?.enabled
  const popMin = inputs.population_constraint?.min_population ?? 50000
  const popMax = inputs.population_constraint?.max_population ?? null
  const popStateFilter = inputs.population_constraint?.state_filter ?? null

  // Build a property list shape constrainedKMeans expects (visits_per_year
  // weighted from service_locations).
  const cKMProps = withCoords.map((p) => {
    const visitsPerYear =
      p.service_locations.find((sl) => sl.visits_per_year_override != null)
        ?.visits_per_year_override ?? DEFAULT_VISITS_PER_YEAR
    return {
      id: p.id,
      lat: p.latitude!,
      lng: p.longitude!,
      visits_per_year: visitsPerYear,
    }
  })

  const lockedAsCities: City[] = inputs.existing_branches.map((b) => ({
    city: b.name,
    state: '',
    state_id: '',
    lat: b.lat,
    lng: b.lng,
    population: 0, // unknown for user-pinned branches; UI annotates "below threshold" if low
  }))

  // Run for each k. Strategy:
  // - If population constraint enabled: constrained-kmeans with eligible cities
  // - Else: pure k-means + reverse-geocode each centroid (legacy path)
  const runs: Array<{
    k: number
    centers: Array<{ lat: number; lng: number; city?: City | null; locked: boolean }>
    assignments: number[]
    distances: number[]
  }> = []

  let eligibleCityCount = 0

  for (let k = kStart; k <= kEnd; k++) {
    if (popEnabled) {
      const result = constrainedKMeans({
        k,
        properties: cKMProps,
        min_population: popMin,
        max_population: popMax,
        state_filter: popStateFilter,
        locked_branches: lockedAsCities.slice(0, Math.min(floorK, k)),
        drive_speed_mph: inputs.drive_speed_mph,
      })
      eligibleCityCount = result.eligible_city_count
      const distances = withCoords.map((p) => {
        const idx = result.assignments[p.id]
        if (idx < 0) return 0
        const c = result.selected_cities[idx]
        return haversineMiles({ lat: p.latitude!, lng: p.longitude! }, { lat: c.lat, lng: c.lng })
      })
      runs.push({
        k,
        centers: result.selected_cities.map((c, idx) => ({
          lat: c.lat,
          lng: c.lng,
          city: c,
          locked: idx < floorK,
        })),
        assignments: withCoords.map((p) => result.assignments[p.id] ?? 0),
        distances,
      })
    } else {
      const result = kmeans(points, k, { seed: 42, lockedCentroids })
      const distances = points.map((p, i) =>
        haversineMiles(p, result.centroids[result.assignments[i]])
      )
      runs.push({
        k,
        centers: result.centroids.map((c, idx) => ({
          lat: c.lat,
          lng: c.lng,
          city: null,
          locked: idx < floorK,
        })),
        assignments: result.assignments,
        distances,
      })
    }
  }

  // For unconstrained centers, reverse-geocode each unique one once. (No-op
  // when constrained — those already carry city data.)
  const centroidLabels = new Map<string, string>()
  const needsReverseGeocode = runs.flatMap((r) =>
    r.centers.filter((c) => !c.city).map((c) => ({ lat: c.lat, lng: c.lng }))
  )
  await Promise.all(
    needsReverseGeocode.map(async (c) => {
      const key = `${c.lat.toFixed(3)},${c.lng.toFixed(3)}`
      if (centroidLabels.has(key)) return
      const r = await reverseGeocodeCityState(c.lat, c.lng)
      centroidLabels.set(key, r.formatted)
    })
  )
  const labelFor = (c: { lat: number; lng: number }) =>
    centroidLabels.get(`${c.lat.toFixed(3)},${c.lng.toFixed(3)}`) ?? 'Unknown location'

  // Cost calculation per run
  const k_results = runs.map((run) => {
    const branchSummary = run.centers.map((c, idx) => {
      const memberIdx = run.assignments
        .map((a, i) => (a === idx ? i : -1))
        .filter((i) => i >= 0)
      const memberDistances = memberIdx.map((i) => run.distances[i])
      const memberSqft = memberIdx.reduce((sum, i) => {
        const sl = withCoords[i].service_locations
        return sum + sl.reduce((s, l) => s + (l.serviceable_sqft ?? 0), 0)
      }, 0)
      const isLocked = c.locked
      const lockedBranch = isLocked ? inputs.existing_branches[idx] : null
      const cityName = c.city
        ? `${c.city.city}, ${c.city.state_id}`
        : lockedBranch?.name ?? labelFor(c)
      const pop = c.city?.population ?? null
      return {
        lat: c.lat,
        lng: c.lng,
        city_state: lockedBranch?.name ?? cityName,
        city: c.city?.city ?? null,
        state: c.city?.state_id ?? null,
        population: pop,
        population_band: pop != null ? populationBand(pop) : null,
        property_count: memberIdx.length,
        total_sqft: memberSqft,
        locked: isLocked,
        source: isLocked ? ('locked' as const) : ('optimization' as const),
        avg_drive_distance_miles:
          memberDistances.length > 0
            ? +(memberDistances.reduce((a, b) => a + b, 0) / memberDistances.length).toFixed(1)
            : 0,
        max_drive_distance_miles:
          memberDistances.length > 0 ? +Math.max(...memberDistances).toFixed(1) : 0,
      }
    })

    // Drive cost: sum over properties of round-trip miles * fuel + round-trip hours * labor
    let driveCost = 0
    for (let i = 0; i < withCoords.length; i++) {
      const p = withCoords[i]
      const dist = run.distances[i]
      const visitsPerYear =
        p.service_locations.find((sl) => sl.visits_per_year_override != null)
          ?.visits_per_year_override ?? DEFAULT_VISITS_PER_YEAR
      const distHours = driveTimeMinutes(dist, inputs.drive_speed_mph) / 60
      driveCost +=
        2 * dist * visitsPerYear * inputs.fuel_cost_per_mile +
        2 * distHours * visitsPerYear * inputs.hourly_labor_cost
    }

    const branchCost = run.k * inputs.fixed_branch_cost_annual
    const totalCost = driveCost + branchCost
    const avgDrivePerProp =
      run.distances.length > 0
        ? +(run.distances.reduce((a, b) => a + b, 0) / run.distances.length).toFixed(1)
        : 0

    return {
      k: run.k,
      branches: branchSummary,
      total_annual_cost: Math.round(totalCost),
      drive_cost: Math.round(driveCost),
      branch_cost: Math.round(branchCost),
      avg_drive_per_property: avgDrivePerProp,
      is_elbow: false,
    }
  })

  // Elbow detection: largest second-derivative drop in total cost across k.
  // (curvature[i] = (cost[i-1] - cost[i]) - (cost[i] - cost[i+1]))
  let recommendedK = k_results[0]?.k ?? 1
  if (k_results.length >= 3) {
    let bestCurvature = -Infinity
    let bestIdx = 0
    for (let i = 1; i < k_results.length - 1; i++) {
      const prev = k_results[i - 1].total_annual_cost
      const cur = k_results[i].total_annual_cost
      const next = k_results[i + 1].total_annual_cost
      const curvature = prev - 2 * cur + next
      if (curvature > bestCurvature) {
        bestCurvature = curvature
        bestIdx = i
      }
    }
    recommendedK = k_results[bestIdx].k
    k_results[bestIdx].is_elbow = true
  } else if (k_results.length === 2) {
    // tiny range — pick the cheaper
    recommendedK =
      k_results[0].total_annual_cost <= k_results[1].total_annual_cost
        ? k_results[0].k
        : k_results[1].k
    const idx = k_results.findIndex((r) => r.k === recommendedK)
    k_results[idx].is_elbow = true
  } else if (k_results.length === 1) {
    k_results[0].is_elbow = true
  }

  const recommendedRow = k_results.find((r) => r.k === recommendedK)
  const summaryParts: string[] = []
  summaryParts.push(
    `Evaluated branch counts k=${kStart}..${kEnd} over ${withCoords.length} properties with coordinates.`
  )
  if (floorK > 0) {
    summaryParts.push(
      `${floorK} existing branch${floorK === 1 ? '' : 'es'} locked — k floor is ${floorK}.`
    )
  }
  if (recommendedRow) {
    const branchList = recommendedRow.branches
      .slice()
      .sort((a, b) => b.property_count - a.property_count)
      .map((b) => `${b.city_state}${b.locked ? ' (locked)' : ''}`)
      .join(', ')
    summaryParts.push(
      `Recommended k=${recommendedK} (elbow): annual cost ~$${recommendedRow.total_annual_cost.toLocaleString()} ($${recommendedRow.drive_cost.toLocaleString()} drive + $${recommendedRow.branch_cost.toLocaleString()} fixed).`
    )
    summaryParts.push(`Branch locations: ${branchList}.`)
  }
  if (properties.length > withCoords.length) {
    summaryParts.push(
      `${properties.length - withCoords.length} properties without coordinates were excluded.`
    )
  }

  // ── Unconstrained reference ────────────────────────────────────────────
  // Always compute pure-k-means costs so the UI can show "what would the
  // optimum be without the population constraint". We label each
  // unconstrained centroid with its nearest dataset city for a hint.
  const unconstrainedReference: Array<{
    k: number
    total_drive_cost: number
    centroids: Array<{
      lat: number
      lng: number
      nearest_city_unconstrained: string | null
      population: number | null
    }>
  }> = []

  for (let k = kStart; k <= kEnd; k++) {
    const result = kmeans(points, k, { seed: 42, lockedCentroids })
    let driveCost = 0
    for (let i = 0; i < points.length; i++) {
      const dist = haversineMiles(points[i], result.centroids[result.assignments[i]])
      const visitsPerYear =
        withCoords[i].service_locations.find((sl) => sl.visits_per_year_override != null)
          ?.visits_per_year_override ?? DEFAULT_VISITS_PER_YEAR
      const distHours = driveTimeMinutes(dist, inputs.drive_speed_mph) / 60
      driveCost +=
        2 * dist * visitsPerYear * inputs.fuel_cost_per_mile +
        2 * distHours * visitsPerYear * inputs.hourly_labor_cost
    }
    unconstrainedReference.push({
      k,
      total_drive_cost: Math.round(driveCost),
      centroids: result.centroids.map((c) => {
        const nc = nearestCity(c.lat, c.lng)
        return {
          lat: c.lat,
          lng: c.lng,
          nearest_city_unconstrained: nc ? `${nc.city}, ${nc.state_id}` : null,
          population: nc?.population ?? null,
        }
      }),
    })
  }

  // Population-constraint summary text addition
  if (popEnabled) {
    summaryParts.push(
      `Population constraint: min ${popMin.toLocaleString()} (${eligibleCityCount} eligible cities${popStateFilter?.length ? ` in ${popStateFilter.join(', ')}` : ''}).`
    )
  } else {
    summaryParts.push('Population constraint disabled — using unconstrained k-means.')
  }

  return {
    outputs: {
      property_count: properties.length,
      k_results,
      recommended_k: recommendedK,
      floor_k: floorK,
      existing_branches: inputs.existing_branches,
      missing_coords_count: properties.length - withCoords.length,
      population_constraint: {
        enabled: popEnabled,
        min_population: popMin,
        max_population: popMax,
        state_filter: popStateFilter,
        eligible_city_count: eligibleCityCount,
      },
      unconstrained_reference: unconstrainedReference,
    },
    summary_text: summaryParts.join(' '),
  }
}
