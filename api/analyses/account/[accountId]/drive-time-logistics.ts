// POST /api/analyses/[accountId]/drive-time-logistics
// Per-property drive analysis from a set of branches; histograms drive time
// buckets, flags long-drive properties, scores cluster efficiency.
//
// If `branches` is omitted, pulls the most recent completed branch_optimization
// run for this account and uses the centroids for `k` (defaulting to that run's
// recommended_k).
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import {
  loadAccountProperties,
  createAnalysisRecord,
  completeAnalysisRecord,
  failAnalysisRecord,
  type AccountProperty,
} from '../../../_lib/analysis/account-data.js'
import { haversineMiles, driveTimeMinutes, type LatLng } from '../../../_lib/analysis/haversine.js'
import {
  loadConstraints,
  applyExclusions,
  requireSelectedBranches,
  NO_SELECTION_ERROR,
} from '../../../_lib/analysis/operational-constraints.js'
import { nearestCity } from '../../../_lib/analysis/constrained-kmeans.js'

// "Houston, TX" derived from the cities dataset by nearest-coords lookup.
// Falls back to the original branch name if no dataset hit (typical for
// truly remote coordinates).
function deriveCityState(b: { name: string; lat: number; lng: number }): string {
  const nc = nearestCity(b.lat, b.lng)
  return nc ? `${nc.city}, ${nc.state_id}` : b.name
}

export interface DriveInputs {
  client_id?: string | null
  k?: number | null
  branches?: Array<{ name: string; lat: number; lng: number }>
  drive_speed_mph: number
  max_one_way_drive_minutes: number
}

// Drive-time analysis is fast — pure haversine math, no external API calls.
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
  const body = (req.body ?? {}) as Partial<DriveInputs>
  const db = createAdminClient()
  const constraints = await loadConstraints(db, accountId)

  // Tier 2: requires the user to have confirmed a branch selection.
  const sel = requireSelectedBranches(constraints)
  if (!sel.ok) return res.status(400).json(NO_SELECTION_ERROR)

  const inputs: DriveInputs = {
    client_id: body.client_id ?? constraints.client_id ?? null,
    k: body.k ?? constraints.selected_k ?? null,
    branches: undefined, // selected_branches always wins
    drive_speed_mph: body.drive_speed_mph ?? constraints.drive_speed_mph,
    max_one_way_drive_minutes:
      body.max_one_way_drive_minutes ?? constraints.max_one_way_drive_minutes,
  }

  let analysisId: string
  try {
    analysisId = await createAnalysisRecord(db, {
      account_id: accountId,
      client_id: inputs.client_id ?? null,
      module_key: 'drive_time_logistics',
      inputs: inputs as unknown as Record<string, unknown>,
      created_by: ctx.userId ?? null,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message ?? 'Failed to create analysis record' })
  }

  try {
    const allProperties = await loadAccountProperties(
      db,
      accountId,
      inputs.client_id ?? null
    )
    const properties = applyExclusions(allProperties, constraints.excluded_property_ids)

    // Tier 2 always uses the user's confirmed branch selection.
    const branches = sel.branches.map((b) => ({
      name: b.name,
      lat: b.lat,
      lng: b.lng,
    }))
    const kUsed = constraints.selected_k ?? branches.length

    const result = computeDriveTimeLogistics(properties, branches, inputs, kUsed)
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

export function computeDriveTimeLogistics(
  properties: AccountProperty[],
  branches: Array<{ name: string; lat: number; lng: number }>,
  inputs: DriveInputs,
  kUsed: number | null
) {
  const withCoords = properties.filter((p) => p.latitude != null && p.longitude != null)

  const buckets = {
    under_30_min: 0,
    '30_to_60_min': 0,
    '60_to_90_min': 0,
    '90_to_120_min': 0,
    over_120_min: 0,
  } as Record<string, number>

  const perProperty: Array<{
    property_id: string
    address: string
    nearest_branch: string
    drive_distance_miles: number
    drive_time_minutes: number
    flags: string[]
  }> = []

  // per-branch tallies
  const branchTallies = new Map<
    string,
    { name: string; total: number; durations: number[]; within60: number }
  >()
  for (const b of branches) {
    branchTallies.set(b.name, { name: b.name, total: 0, durations: [], within60: 0 })
  }

  for (const p of withCoords) {
    const me: LatLng = { lat: p.latitude!, lng: p.longitude! }
    let bestBranch = branches[0]
    let bestDist = Infinity
    for (const b of branches) {
      const d = haversineMiles(me, { lat: b.lat, lng: b.lng })
      if (d < bestDist) {
        bestDist = d
        bestBranch = b
      }
    }
    const minutes = driveTimeMinutes(bestDist, inputs.drive_speed_mph)
    const flags: string[] = []
    if (minutes > inputs.max_one_way_drive_minutes) flags.push('long_drive')
    if (minutes > 180) flags.push('remote_outlier')

    if (minutes < 30) buckets.under_30_min += 1
    else if (minutes < 60) buckets['30_to_60_min'] += 1
    else if (minutes < 90) buckets['60_to_90_min'] += 1
    else if (minutes < 120) buckets['90_to_120_min'] += 1
    else buckets.over_120_min += 1

    const tally = branchTallies.get(bestBranch.name)!
    tally.total += 1
    tally.durations.push(minutes)
    if (minutes <= 60) tally.within60 += 1

    perProperty.push({
      property_id: p.id,
      address: `${p.address_line1}, ${p.city}, ${p.state}`,
      nearest_branch: deriveCityState(bestBranch),
      drive_distance_miles: +bestDist.toFixed(1),
      drive_time_minutes: Math.round(minutes),
      flags,
    })
  }

  perProperty.sort((a, b) => b.drive_time_minutes - a.drive_time_minutes)

  // Pre-compute city_state once per branch so cluster_efficiency rows + the
  // long-drive list both render with real "Houston, TX" labels regardless of
  // what the user named their branch in the selection workflow.
  const branchCityState = new Map<string, string>()
  for (const b of branches) {
    branchCityState.set(b.name, deriveCityState(b))
  }

  const cluster_efficiency = Array.from(branchTallies.values()).map((t) => {
    const avg =
      t.durations.length > 0
        ? Math.round(t.durations.reduce((a, b) => a + b, 0) / t.durations.length)
        : 0
    const pct = t.total > 0 ? Math.round((t.within60 / t.total) * 100) : 0
    let efficiency_score: 'high' | 'medium' | 'low' = 'low'
    if (pct >= 80) efficiency_score = 'high'
    else if (pct >= 60) efficiency_score = 'medium'
    return {
      branch: t.name,
      city_state: branchCityState.get(t.name) ?? t.name,
      property_count: t.total,
      avg_drive_minutes: avg,
      properties_within_60min_pct: pct,
      efficiency_score,
    }
  })

  const long_drive_properties = perProperty
    .filter((p) => p.drive_time_minutes > inputs.max_one_way_drive_minutes)
    .map((p) => ({
      property_id: p.property_id,
      address: p.address,
      drive_minutes: p.drive_time_minutes,
    }))

  const totalAnalyzed = withCoords.length
  const within60 = buckets.under_30_min + buckets['30_to_60_min']
  const summaryParts: string[] = []
  summaryParts.push(
    `${totalAnalyzed} properties analyzed against ${branches.length} branch${branches.length === 1 ? '' : 'es'}${
      kUsed ? ` (k=${kUsed})` : ''
    }.`
  )
  if (totalAnalyzed > 0) {
    summaryParts.push(
      `${within60} (${Math.round((within60 / totalAnalyzed) * 100)}%) are within 60-minute drive.`
    )
  }
  if (long_drive_properties.length > 0) {
    summaryParts.push(
      `${long_drive_properties.length} ${
        long_drive_properties.length === 1 ? 'property exceeds' : 'properties exceed'
      } the ${inputs.max_one_way_drive_minutes}-min one-way threshold.`
    )
  }
  if (properties.length - withCoords.length > 0) {
    summaryParts.push(
      `${properties.length - withCoords.length} properties without coordinates were skipped.`
    )
  }

  return {
    outputs: {
      property_count: properties.length,
      k_used: kUsed,
      branches_used: branches.map((b) => ({
        ...b,
        city_state: deriveCityState(b),
      })),
      drive_distribution: buckets,
      per_property: perProperty,
      cluster_efficiency,
      long_drive_properties,
      missing_coords_count: properties.length - withCoords.length,
    },
    summary_text: summaryParts.join(' '),
  }
}
