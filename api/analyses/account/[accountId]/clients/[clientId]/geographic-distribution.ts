// POST /api/analyses/[accountId]/geographic-distribution
// State + region breakdown of an account's portfolio, plus geographic outliers
// (>300mi from the nearest region centroid).
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../../../_lib/supabase.js'
import { authenticateRequest } from '../../../../../_lib/auth.js'
import {
  loadAccountProperties,
  createAnalysisRecord,
  completeAnalysisRecord,
  failAnalysisRecord,
  type AccountProperty,
} from '../../../../../_lib/analysis/account-data.js'
import { haversineMiles, centroid, type LatLng } from '../../../../../_lib/analysis/haversine.js'
import { regionForState, REGION_MAP } from '../../../../../_lib/analysis/regions.js'
import {
  loadConstraints,
  applyExclusions,
} from '../../../../../_lib/analysis/operational-constraints.js'

const OUTLIER_THRESHOLD_MI = 300

// Geographic analysis is fast (<5s for 524 properties). Run synchronously and
// hold the request open so the row is guaranteed to reach a terminal state
// before we respond — fire-and-forget after res.end() is unreliable on Vercel.
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
  const body = (req.body ?? {}) as { client_id?: string | null }
  const db = createAdminClient()

  let analysisId: string
  try {
    analysisId = await createAnalysisRecord(db, {
      account_id: accountId,
      client_id: clientId,
      module_key: 'geographic_distribution',
      inputs: { client_id: body.client_id ?? null },
      created_by: ctx.userId ?? null,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message ?? 'Failed to create analysis record' })
  }

  try {
    const constraints = await loadConstraints(db, accountId, clientId)
    const allProperties = await loadAccountProperties(db, accountId, clientId)
    const properties = applyExclusions(allProperties, constraints.excluded_property_ids)
    const result = computeGeographicDistribution(properties, allProperties.length - properties.length)
    await completeAnalysisRecord(db, analysisId, {
      outputs: result.outputs,
      summary_text: result.summary_text,
      property_count: properties.length,
    })
    return res.status(200).json({ analysis_id: analysisId, status: 'completed' })
  } catch (err: any) {
    const msg = err?.message ?? String(err)
    await failAnalysisRecord(db, analysisId, msg)
    return res.status(500).json({ analysis_id: analysisId, status: 'failed', error: msg })
  }
}

export function computeGeographicDistribution(properties: AccountProperty[], excludedCount = 0) {
  const total = properties.length
  const withCoords = properties.filter(
    (p) => p.latitude != null && p.longitude != null
  )
  const missingCoords = total - withCoords.length

  // States
  const stateMap = new Map<string, { property_count: number; sl_count: number; total_sqft: number }>()
  for (const p of properties) {
    const s = (p.state || 'XX').toUpperCase()
    const cur = stateMap.get(s) ?? { property_count: 0, sl_count: 0, total_sqft: 0 }
    cur.property_count += 1
    cur.sl_count += p.service_locations.length
    cur.total_sqft += p.service_locations.reduce(
      (sum, sl) => sum + (sl.serviceable_sqft ?? 0),
      0
    )
    stateMap.set(s, cur)
  }
  const states = Array.from(stateMap.entries())
    .map(([state, v]) => ({
      state,
      property_count: v.property_count,
      service_location_count: v.sl_count,
      total_sqft: v.total_sqft,
      pct_of_portfolio: total > 0 ? +((v.property_count / total) * 100).toFixed(1) : 0,
    }))
    .sort((a, b) => b.property_count - a.property_count)

  // Regions: only include regions that actually have properties
  const regionPoints = new Map<string, { points: LatLng[]; pCount: number; states: Set<string> }>()
  for (const p of properties) {
    const region = regionForState(p.state)
    const entry = regionPoints.get(region) ?? {
      points: [],
      pCount: 0,
      states: new Set<string>(),
    }
    entry.pCount += 1
    if (p.state) entry.states.add(p.state.toUpperCase())
    if (p.latitude != null && p.longitude != null) {
      entry.points.push({ lat: p.latitude, lng: p.longitude })
    }
    regionPoints.set(region, entry)
  }
  const regions = Array.from(regionPoints.entries())
    .map(([region_name, v]) => ({
      region_name,
      states: Array.from(v.states).sort(),
      property_count: v.pCount,
      centroid: v.points.length > 0 ? centroid(v.points) : { lat: 0, lng: 0 },
    }))
    .sort((a, b) => b.property_count - a.property_count)

  // Outliers: nearest region centroid > 300mi
  const populatedCentroids = regions.filter((r) => r.property_count >= 3 && r.centroid.lat !== 0)
  const outliers: Array<{
    property_id: string
    address: string
    city: string
    state: string
    nearest_cluster_distance_miles: number
    nearest_cluster_region: string
    note: string
  }> = []

  if (populatedCentroids.length > 0) {
    for (const p of withCoords) {
      const me: LatLng = { lat: p.latitude!, lng: p.longitude! }
      let bestDist = Infinity
      let bestRegion = ''
      for (const r of populatedCentroids) {
        const d = haversineMiles(me, r.centroid)
        if (d < bestDist) {
          bestDist = d
          bestRegion = r.region_name
        }
      }
      if (bestDist > OUTLIER_THRESHOLD_MI) {
        outliers.push({
          property_id: p.id,
          address: p.address_line1,
          city: p.city,
          state: p.state,
          nearest_cluster_distance_miles: Math.round(bestDist),
          nearest_cluster_region: bestRegion,
          note: `Geographic outlier — ${Math.round(bestDist)} miles from nearest cluster (${bestRegion})`,
        })
      }
    }
  }
  outliers.sort((a, b) => b.nearest_cluster_distance_miles - a.nearest_cluster_distance_miles)

  // Summary text
  const topState = states[0]
  const topRegion = regions[0]
  const summaryParts: string[] = []
  summaryParts.push(
    `Portfolio of ${total} properties spans ${states.length} states across ${regions.length} regions.`
  )
  if (topRegion) {
    summaryParts.push(
      `${topRegion.region_name} is the largest region with ${topRegion.property_count} properties (${
        total > 0 ? Math.round((topRegion.property_count / total) * 100) : 0
      }% of portfolio).`
    )
  }
  if (topState) {
    summaryParts.push(
      `${topState.state} alone accounts for ${topState.property_count} properties.`
    )
  }
  if (outliers.length > 0) {
    summaryParts.push(
      `${outliers.length} ${outliers.length === 1 ? 'property is' : 'properties are'} flagged as geographic outliers (>${OUTLIER_THRESHOLD_MI}mi from any cluster).`
    )
  }
  if (missingCoords > 0) {
    summaryParts.push(
      `${missingCoords} ${missingCoords === 1 ? 'property is' : 'properties are'} missing coordinates and were skipped from outlier detection.`
    )
  }
  if (excludedCount > 0) {
    summaryParts.push(
      `${excludedCount} ${excludedCount === 1 ? 'property was' : 'properties were'} excluded per operational constraints.`
    )
  }
  const summary_text = summaryParts.join(' ')

  return {
    outputs: {
      property_count: total,
      excluded_property_count: excludedCount,
      states,
      regions,
      outliers,
      defined_regions: Object.keys(REGION_MAP),
      missing_coords_count: missingCoords,
    },
    summary_text,
  }
}
