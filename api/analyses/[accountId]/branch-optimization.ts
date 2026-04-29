// POST /api/analyses/[accountId]/branch-optimization
// k-means over property coordinates for k = k_range[0]..k_range[1]; returns
// per-k cost breakdown (drive cost + fixed branch cost), recommended elbow,
// and reverse-geocoded city names for each centroid.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'
import {
  loadAccountProperties,
  createAnalysisRecord,
  completeAnalysisRecord,
  failAnalysisRecord,
  hashInputs,
  type AccountProperty,
} from '../../_lib/analysis/account-data.js'
import { haversineMiles, driveTimeMinutes, type LatLng } from '../../_lib/analysis/haversine.js'
import { kmeans } from '../../_lib/analysis/kmeans.js'
import { reverseGeocodeCityState } from '../../_lib/analysis/reverse-geocode.js'

interface BranchOptInputs {
  client_id?: string | null
  k_range: [number, number]
  drive_speed_mph: number
  hourly_labor_cost: number
  fuel_cost_per_mile: number
  fixed_branch_cost_annual: number
  existing_branches: Array<{ name: string; lat: number; lng: number }>
}

const DEFAULT_VISITS_PER_YEAR = 4

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
  const body = (req.body ?? {}) as Partial<BranchOptInputs>
  const inputs: BranchOptInputs = {
    client_id: body.client_id ?? null,
    k_range: body.k_range ?? [1, 7],
    drive_speed_mph: body.drive_speed_mph ?? 60,
    hourly_labor_cost: body.hourly_labor_cost ?? 28,
    fuel_cost_per_mile: body.fuel_cost_per_mile ?? 0.18,
    fixed_branch_cost_annual: body.fixed_branch_cost_annual ?? 240000,
    existing_branches: body.existing_branches ?? [],
  }

  const db = createAdminClient()

  // Cache: if a completed run exists with the same inputs hash for this account, return it.
  const cacheKey = hashInputs({ accountId, ...inputs })
  const cached = await db
    .from('portfolio_analyses')
    .select('id, inputs')
    .eq('account_id', accountId)
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
      client_id: inputs.client_id ?? null,
      module_key: 'branch_optimization',
      inputs: { ...inputs, _cache_key: cacheKey },
      created_by: ctx.userId ?? null,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message ?? 'Failed to create analysis record' })
  }

  res.status(202).json({ analysis_id: analysisId, status: 'running' })

  ;(async () => {
    try {
      const properties = await loadAccountProperties(db, accountId, inputs.client_id ?? null)
      const result = await computeBranchOptimization(properties, inputs)
      await completeAnalysisRecord(db, analysisId, {
        outputs: result.outputs,
        summary_text: result.summary_text,
        property_count: properties.length,
      })
    } catch (err: any) {
      await failAnalysisRecord(db, analysisId, err.message ?? String(err))
    }
  })()
}

async function computeBranchOptimization(
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

  const [kMin, kMax] = inputs.k_range
  const kStart = Math.max(1, Math.min(kMin, kMax))
  const kEnd = Math.max(kStart, Math.min(kMax, points.length))

  // Run k-means for each k
  const runs: Array<{
    k: number
    centroids: LatLng[]
    assignments: number[]
    distances: number[]
  }> = []

  for (let k = kStart; k <= kEnd; k++) {
    const result = kmeans(points, k, { seed: 42, lockedCentroids })
    const distances = points.map((p, i) =>
      haversineMiles(p, result.centroids[result.assignments[i]])
    )
    runs.push({ k, centroids: result.centroids, assignments: result.assignments, distances })
  }

  // Reverse-geocode each unique centroid (across all k-values) once.
  const centroidLabels = new Map<string, string>()
  const allCentroids = runs.flatMap((r) => r.centroids)
  await Promise.all(
    allCentroids.map(async (c) => {
      const key = `${c.lat.toFixed(3)},${c.lng.toFixed(3)}`
      if (centroidLabels.has(key)) return
      const r = await reverseGeocodeCityState(c.lat, c.lng)
      centroidLabels.set(key, r.formatted)
    })
  )
  const labelFor = (c: LatLng) =>
    centroidLabels.get(`${c.lat.toFixed(3)},${c.lng.toFixed(3)}`) ?? 'Unknown location'

  // Cost calculation per run
  const k_results = runs.map((run) => {
    const branchSummary = run.centroids.map((c, idx) => {
      const memberIdx = run.assignments
        .map((a, i) => (a === idx ? i : -1))
        .filter((i) => i >= 0)
      const memberDistances = memberIdx.map((i) => run.distances[i])
      const memberSqft = memberIdx.reduce((sum, i) => {
        const sl = withCoords[i].service_locations
        return sum + sl.reduce((s, l) => s + (l.serviceable_sqft ?? 0), 0)
      }, 0)
      return {
        lat: c.lat,
        lng: c.lng,
        city_state: labelFor(c),
        property_count: memberIdx.length,
        total_sqft: memberSqft,
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
  if (recommendedRow) {
    const branchList = recommendedRow.branches
      .slice()
      .sort((a, b) => b.property_count - a.property_count)
      .map((b) => b.city_state)
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

  return {
    outputs: {
      property_count: properties.length,
      k_results,
      recommended_k: recommendedK,
      missing_coords_count: properties.length - withCoords.length,
    },
    summary_text: summaryParts.join(' '),
  }
}
