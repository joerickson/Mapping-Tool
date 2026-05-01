// POST /api/v1/clients/[id]/manual-trips/suggest
//
// Smart trip suggestion. Walks the client's properties, clusters them
// by their nearest branch + a density radius, and emits suggested
// trips that the user can accept (POST to /manual-trips) or tweak.
//
// Body: { exclude_property_ids?: string[], cluster_radius_miles?: number }
//   exclude_property_ids: properties already in saved trips that the
//   user doesn't want to re-suggest. UI passes this so suggestions
//   only cover unassigned properties.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../../_lib/supabase.js'
import { authenticateRequest } from '../../../../_lib/auth.js'
import {
  loadConstraints,
  type SelectedBranch,
} from '../../../../_lib/analysis/operational-constraints.js'
import { haversineMiles, driveTimeMinutes } from '../../../../_lib/analysis/haversine.js'

export const config = { maxDuration: 30 }

const DEFAULT_CLUSTER_RADIUS_MILES = 30

interface PropertyRow {
  id: string
  address_line1: string | null
  city: string | null
  state: string | null
  latitude: number | null
  longitude: number | null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const clientId = req.query.id as string
  if (!clientId) return res.status(400).json({ error: 'client id required' })
  const db = createAdminClient()

  const { data: clientRow } = await db
    .from('clients')
    .select('account_id')
    .eq('id', clientId)
    .maybeSingle()
  const accountId = (clientRow as any)?.account_id as string | undefined
  if (!accountId) return res.status(404).json({ error: 'Client not found' })

  const constraints = await loadConstraints(db, accountId, clientId)
  const branches: SelectedBranch[] = constraints.selected_branches ?? []
  if (branches.length === 0) {
    return res.status(400).json({
      error: 'No branches selected. Confirm a branch selection first.',
    })
  }
  const driveSpeed = constraints.drive_speed_mph ?? 60
  const triggerHours =
    constraints.hotel_cost_config?.overnight_trigger_one_way_hours ?? 3

  const body = (req.body ?? {}) as Record<string, unknown>
  const exclude = new Set(
    Array.isArray(body.exclude_property_ids)
      ? (body.exclude_property_ids as string[])
      : []
  )
  const clusterRadius = Number.isFinite(body.cluster_radius_miles as number)
    ? Math.max(5, Number(body.cluster_radius_miles))
    : DEFAULT_CLUSTER_RADIUS_MILES

  // Pull all properties that have at least one SL on this client.
  const { data: slRows } = await db
    .from('service_locations')
    .select('property_id')
    .eq('client_id', clientId)
  const propIds = Array.from(
    new Set((slRows ?? []).map((r) => (r as any).property_id as string))
  ).filter((id) => !exclude.has(id))
  if (propIds.length === 0) {
    return res.status(200).json({ suggestions: [] })
  }
  const properties: PropertyRow[] = []
  for (let i = 0; i < propIds.length; i += 250) {
    const chunk = propIds.slice(i, i + 250)
    const { data } = await db
      .from('properties')
      .select('id, address_line1, city, state, latitude, longitude')
      .in('id', chunk)
    for (const p of data ?? []) properties.push(p as PropertyRow)
  }

  // 1. Bucket each property into "remote enough to suggest as a trip"
  //    (drive-hours from nearest branch > overnight threshold) vs
  //    "day-trip" (close enough that a trip isn't useful — already
  //    covered by routine routing).
  type Bucket = { branchIdx: number; props: PropertyRow[] }
  const remoteByBranch = new Map<number, PropertyRow[]>()
  for (const p of properties) {
    if (p.latitude == null || p.longitude == null) continue
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < branches.length; i++) {
      const d = haversineMiles(
        { lat: p.latitude, lng: p.longitude },
        { lat: branches[i].lat, lng: branches[i].lng }
      )
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
    const oneWayHr = driveTimeMinutes(bestDist, driveSpeed) / 60
    if (oneWayHr > triggerHours) {
      const arr = remoteByBranch.get(bestIdx) ?? []
      arr.push(p)
      remoteByBranch.set(bestIdx, arr)
    }
  }

  // 2. Density-cluster the remote properties within clusterRadius
  //    of each other, per-branch (a Frisco-anchored trip shouldn't
  //    pull in an Albuquerque-anchored property even if they happen
  //    to be near each other).
  type Suggestion = {
    suggested_name: string
    branch_name: string
    branch_city_state: string | null
    property_ids: string[]
    addresses: string[]
    centroid_lat: number
    centroid_lng: number
    one_way_drive_hours_to_centroid: number
    miles_per_trip_estimate: number
    estimated_nights_per_trip: number
    rationale: string
  }
  const suggestions: Suggestion[] = []
  for (const [branchIdx, props] of remoteByBranch) {
    const clusters = densityCluster(
      props.map((p) => ({ id: p.id, lat: p.latitude!, lng: p.longitude! })),
      clusterRadius
    )
    const branch = branches[branchIdx]
    for (let ci = 0; ci < clusters.length; ci++) {
      const ids = clusters[ci]
      const inCluster = props.filter((p) => ids.has(p.id))
      if (inCluster.length === 0) continue

      const lats = inCluster.map((p) => p.latitude!)
      const lngs = inCluster.map((p) => p.longitude!)
      const cLat = lats.reduce((s, v) => s + v, 0) / lats.length
      const cLng = lngs.reduce((s, v) => s + v, 0) / lngs.length
      const distMi = haversineMiles(
        { lat: branch.lat, lng: branch.lng },
        { lat: cLat, lng: cLng }
      )
      const oneWayHours = driveTimeMinutes(distMi, driveSpeed) / 60
      // Mileage estimate: 2× one-way (out+back) + half the
      // intra-cluster spread as a rough proxy for between-stops drives.
      let intraSum = 0
      for (let i = 0; i < inCluster.length - 1; i++) {
        intraSum += haversineMiles(
          { lat: inCluster[i].latitude!, lng: inCluster[i].longitude! },
          { lat: inCluster[i + 1].latitude!, lng: inCluster[i + 1].longitude! }
        )
      }
      const milesEstimate = distMi * 2 + intraSum

      // Build a short, human label from city/state of first prop +
      // count, e.g. "Albuquerque NM area (8 properties)".
      const firstCity = inCluster[0].city ?? ''
      const firstState = inCluster[0].state ?? ''
      const labelLoc = firstCity && firstState
        ? `${firstCity} ${firstState}`
        : firstCity || firstState || 'cluster'

      suggestions.push({
        suggested_name: `${labelLoc} (${inCluster.length} properties)`,
        branch_name: branch.name,
        branch_city_state: branch.city_state ?? null,
        property_ids: inCluster.map((p) => p.id),
        addresses: inCluster.map(
          (p) => p.address_line1 ?? `${p.id.slice(0, 8)}…`
        ),
        centroid_lat: cLat,
        centroid_lng: cLng,
        one_way_drive_hours_to_centroid: Math.round(oneWayHours * 100) / 100,
        miles_per_trip_estimate: Math.round(milesEstimate * 10) / 10,
        estimated_nights_per_trip: Math.max(1, inCluster.length),
        rationale: `${inCluster.length} properties within ${clusterRadius} mi of each other, ${Math.round(oneWayHours * 10) / 10} hr drive from ${branch.name}.`,
      })
    }
  }

  // Largest first — those are the highest-leverage trip suggestions.
  suggestions.sort((a, b) => b.property_ids.length - a.property_ids.length)
  return res.status(200).json({ suggestions })
}

// Single-link agglomerative density clustering: union-find any two
// items within `radiusMiles` of each other. O(n²) pairwise check —
// fine for the property volumes this endpoint handles.
function densityCluster<T extends { id: string; lat: number; lng: number }>(
  items: T[],
  radiusMiles: number
): Array<Set<string>> {
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
  const groups = new Map<number, Set<string>>()
  for (let i = 0; i < items.length; i++) {
    const r = find(i)
    const set = groups.get(r) ?? new Set<string>()
    set.add(items[i].id)
    groups.set(r, set)
  }
  return Array.from(groups.values())
}
