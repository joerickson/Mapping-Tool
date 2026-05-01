// POST /api/v1/clients/[id]/manual-trips/split
//
// Split one saved trip into N smaller trips. Properties are grouped
// geographically by sorting along the dominant lat/lng axis and chunking
// into N roughly-equal-size sub-clusters. Original trip is deleted; new
// trips are created with a "(i of N)" suffix on the name.
//
// Body: { trip_id: string, num_splits: number }
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../../_lib/supabase.js'
import { authenticateRequest } from '../../../../_lib/auth.js'

export const config = { maxDuration: 30 }

interface TripRow {
  id: string
  account_id: string
  client_id: string
  name: string
  branch_name: string
  property_ids: string[]
  visits_per_year: number
  notes: string | null
}

interface PropertyRow {
  id: string
  latitude: number | null
  longitude: number | null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const clientId = req.query.id as string
  if (!clientId) return res.status(400).json({ error: 'client id required' })

  const body = (req.body ?? {}) as Record<string, unknown>
  const tripId = typeof body.trip_id === 'string' ? body.trip_id : null
  const numSplits = Number(body.num_splits)
  if (!tripId) return res.status(400).json({ error: 'trip_id required' })
  if (!Number.isFinite(numSplits) || numSplits < 2 || numSplits > 20) {
    return res.status(400).json({ error: 'num_splits must be between 2 and 20' })
  }

  const db = createAdminClient()

  const { data: clientRow } = await db
    .from('clients')
    .select('account_id')
    .eq('id', clientId)
    .maybeSingle()
  const accountId = (clientRow as any)?.account_id as string | undefined
  if (!accountId) return res.status(404).json({ error: 'Client not found' })

  const { data: tripData, error: tripErr } = await db
    .from('manual_trips')
    .select('*')
    .eq('id', tripId)
    .eq('account_id', accountId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (tripErr) return res.status(500).json({ error: tripErr.message })
  if (!tripData) return res.status(404).json({ error: 'Trip not found' })
  const trip = tripData as TripRow

  if (trip.property_ids.length < 2) {
    return res
      .status(400)
      .json({ error: 'Trip must have at least 2 properties to split' })
  }
  // Cap splits at the property count — splitting 5 props into 8 trips makes
  // no sense.
  const k = Math.min(numSplits, trip.property_ids.length)

  // Pull lat/lng for each property in chunks (PostgREST URL limit).
  const properties: PropertyRow[] = []
  for (let i = 0; i < trip.property_ids.length; i += 250) {
    const chunk = trip.property_ids.slice(i, i + 250)
    const { data } = await db
      .from('properties')
      .select('id, latitude, longitude')
      .in('id', chunk)
    for (const p of data ?? []) properties.push(p as PropertyRow)
  }

  // Build the split groups.
  const groups = sortChunkSplit(properties, k)

  // Create new trips one-by-one (small N, sequential is fine and gives us
  // explicit error handling per insert).
  const createdIds: string[] = []
  for (let i = 0; i < groups.length; i++) {
    const ids = groups[i]
    const { data: inserted, error: insertErr } = await db
      .from('manual_trips')
      .insert({
        account_id: accountId,
        client_id: clientId,
        name: `${trip.name} (${i + 1} of ${groups.length})`,
        branch_name: trip.branch_name,
        property_ids: ids,
        visits_per_year: trip.visits_per_year,
        notes: trip.notes,
      })
      .select('id')
      .single()
    if (insertErr) {
      // Roll back: delete any trips we already created.
      if (createdIds.length > 0) {
        await db.from('manual_trips').delete().in('id', createdIds)
      }
      return res.status(500).json({
        error: `Split failed on group ${i + 1}: ${insertErr.message}`,
      })
    }
    createdIds.push((inserted as any).id as string)
  }

  // Delete the original trip last so failure leaves the original intact.
  const { error: delErr } = await db
    .from('manual_trips')
    .delete()
    .eq('id', tripId)
    .eq('account_id', accountId)
    .eq('client_id', clientId)
  if (delErr) {
    // Original still exists, new trips also exist — surface the partial
    // state so the user can clean up.
    return res.status(500).json({
      error: `Created ${createdIds.length} new trips but failed to delete original: ${delErr.message}`,
      created_trip_ids: createdIds,
    })
  }

  return res.status(200).json({
    new_trip_ids: createdIds,
    deleted_trip_id: tripId,
  })
}

// Split properties into k roughly-balanced groups by sorting along the
// dominant lat/lng axis and chunking. Properties without coords land at
// the end of the sort and get distributed into whichever chunk has room.
// O(n log n). Good geographic locality for elongated clusters; perfect
// balance on counts.
function sortChunkSplit(props: PropertyRow[], k: number): string[][] {
  if (props.length === 0) return []
  if (k <= 1) return [props.map((p) => p.id)]

  // Pick the axis with the larger range so the split makes geographic
  // sense for the cluster's actual shape.
  const lats = props.map((p) => p.latitude).filter((v): v is number => v != null)
  const lngs = props.map((p) => p.longitude).filter((v): v is number => v != null)
  const latRange = lats.length ? Math.max(...lats) - Math.min(...lats) : 0
  const lngRange = lngs.length ? Math.max(...lngs) - Math.min(...lngs) : 0
  const sortByLat = latRange >= lngRange

  const sorted = [...props].sort((a, b) => {
    const av = sortByLat ? a.latitude : a.longitude
    const bv = sortByLat ? b.latitude : b.longitude
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return av - bv
  })

  const baseSize = Math.floor(props.length / k)
  const remainder = props.length % k
  const groups: string[][] = []
  let cursor = 0
  for (let i = 0; i < k; i++) {
    // Distribute the remainder across the first `remainder` groups so
    // sizes differ by at most 1.
    const size = baseSize + (i < remainder ? 1 : 0)
    groups.push(sorted.slice(cursor, cursor + size).map((p) => p.id))
    cursor += size
  }
  return groups
}
