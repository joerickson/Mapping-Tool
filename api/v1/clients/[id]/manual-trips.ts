// GET  /api/v1/clients/[id]/manual-trips
//   → { trips: ManualTripWithMetrics[], properties: TravelProperty[] }
//   The travel planner page calls this once and gets everything it
//   needs: per-trip metrics (nights, miles, cost) and the per-property
//   list with branch assignment + drive miles. Computing metrics
//   server-side keeps the client dumb and avoids re-implementing the
//   haversine / overnight math in two places.
//
// POST /api/v1/clients/[id]/manual-trips
//   Body: { name, branch_name, property_ids[], visits_per_year?, notes? }
//   Creates a trip. Returns the created row.
//
// PATCH /api/v1/clients/[id]/manual-trips
//   Body: { trip_id, ...partial }  Updates an existing trip.
//
// DELETE /api/v1/clients/[id]/manual-trips
//   Body: { trip_id }
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import {
  loadConstraints,
  type SelectedBranch,
} from '../../../_lib/analysis/operational-constraints.js'
import { haversineMiles, driveTimeMinutes } from '../../../_lib/analysis/haversine.js'

export const config = { maxDuration: 30 }

interface PropertyRow {
  id: string
  address_line1: string | null
  city: string | null
  state: string | null
  latitude: number | null
  longitude: number | null
}

interface TripRow {
  id: string
  account_id: string
  client_id: string
  name: string
  branch_name: string
  property_ids: string[]
  visits_per_year: number
  notes: string | null
  created_at: string
  updated_at: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
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
  const driveSpeed = constraints.drive_speed_mph ?? 60
  const hotelConfig = constraints.hotel_cost_config

  if (req.method === 'GET') {
    const { trips, properties } = await loadTripsAndProperties(
      db,
      accountId,
      clientId
    )
    return res.status(200).json({
      trips: trips.map((t) =>
        annotateTrip(t, properties, branches, driveSpeed, hotelConfig)
      ),
      properties: annotateProperties(properties, branches, driveSpeed),
      branches: branches.map((b) => ({
        name: b.name,
        city_state: b.city_state ?? null,
        lat: b.lat,
        lng: b.lng,
      })),
      hotel_config: hotelConfig,
    })
  }

  if (req.method === 'POST') {
    const body = (req.body ?? {}) as Record<string, unknown>
    if (!body.name || typeof body.name !== 'string') {
      return res.status(400).json({ error: 'name required' })
    }
    if (!body.branch_name || typeof body.branch_name !== 'string') {
      return res.status(400).json({ error: 'branch_name required' })
    }
    const propertyIds = Array.isArray(body.property_ids)
      ? (body.property_ids as string[])
      : []
    if (propertyIds.length === 0) {
      return res.status(400).json({ error: 'property_ids must be non-empty' })
    }
    const visitsPerYear = Number.isFinite(body.visits_per_year as number)
      ? Math.max(1, Math.floor(Number(body.visits_per_year)))
      : 1
    const { data, error } = await db
      .from('manual_trips')
      .insert({
        account_id: accountId,
        client_id: clientId,
        name: body.name.trim(),
        branch_name: body.branch_name.trim(),
        property_ids: propertyIds,
        visits_per_year: visitsPerYear,
        notes: typeof body.notes === 'string' ? body.notes : null,
      })
      .select('*')
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ trip: data })
  }

  if (req.method === 'PATCH') {
    const body = (req.body ?? {}) as Record<string, unknown>
    const tripId = body.trip_id as string | undefined
    if (!tripId) return res.status(400).json({ error: 'trip_id required' })
    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }
    if (typeof body.name === 'string') update.name = body.name.trim()
    if (typeof body.branch_name === 'string') update.branch_name = body.branch_name.trim()
    if (Array.isArray(body.property_ids)) update.property_ids = body.property_ids
    if (Number.isFinite(body.visits_per_year as number)) {
      update.visits_per_year = Math.max(1, Math.floor(Number(body.visits_per_year)))
    }
    if (typeof body.notes === 'string' || body.notes === null) update.notes = body.notes
    const { data, error } = await db
      .from('manual_trips')
      .update(update)
      .eq('id', tripId)
      .eq('account_id', accountId)
      .eq('client_id', clientId)
      .select('*')
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ trip: data })
  }

  if (req.method === 'DELETE') {
    const body = (req.body ?? {}) as Record<string, unknown>
    const tripId = body.trip_id as string | undefined
    if (!tripId) return res.status(400).json({ error: 'trip_id required' })
    const { error } = await db
      .from('manual_trips')
      .delete()
      .eq('id', tripId)
      .eq('account_id', accountId)
      .eq('client_id', clientId)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(204).end()
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

async function loadTripsAndProperties(
  db: ReturnType<typeof createAdminClient>,
  accountId: string,
  clientId: string
): Promise<{ trips: TripRow[]; properties: PropertyRow[] }> {
  const [tripsRes, slRes] = await Promise.all([
    db
      .from('manual_trips')
      .select('*')
      .eq('account_id', accountId)
      .eq('client_id', clientId)
      .order('created_at', { ascending: true }),
    db
      .from('service_locations')
      .select('property_id')
      .eq('client_id', clientId),
  ])
  const trips = ((tripsRes.data ?? []) as TripRow[])
  const propIds = Array.from(
    new Set(((slRes.data ?? []) as { property_id: string }[]).map((r) => r.property_id))
  )
  let properties: PropertyRow[] = []
  // Chunk to stay under PostgREST's URL length limit on huge clients.
  for (let i = 0; i < propIds.length; i += 250) {
    const chunk = propIds.slice(i, i + 250)
    const { data } = await db
      .from('properties')
      .select('id, address_line1, city, state, latitude, longitude')
      .in('id', chunk)
    for (const p of data ?? []) properties.push(p as PropertyRow)
  }
  return { trips, properties }
}

function nearestBranch(
  prop: PropertyRow,
  branches: SelectedBranch[]
): { branch: SelectedBranch | null; miles: number } {
  if (
    !branches.length ||
    prop.latitude == null ||
    prop.longitude == null
  ) {
    return { branch: null, miles: 0 }
  }
  let best: SelectedBranch | null = null
  let bestMi = Infinity
  for (const b of branches) {
    const d = haversineMiles(
      { lat: prop.latitude, lng: prop.longitude },
      { lat: b.lat, lng: b.lng }
    )
    if (d < bestMi) {
      bestMi = d
      best = b
    }
  }
  return { branch: best, miles: bestMi }
}

function annotateProperties(
  properties: PropertyRow[],
  branches: SelectedBranch[],
  driveSpeed: number
) {
  return properties.map((p) => {
    const { branch, miles } = nearestBranch(p, branches)
    const driveMin = miles > 0 ? driveTimeMinutes(miles, driveSpeed) : 0
    return {
      property_id: p.id,
      address_line1: p.address_line1,
      city: p.city,
      state: p.state,
      lat: p.latitude,
      lng: p.longitude,
      assigned_branch: branch?.name ?? null,
      assigned_branch_city_state: branch?.city_state ?? null,
      miles_to_branch: Math.round(miles * 10) / 10,
      drive_minutes_to_branch: Math.round(driveMin),
    }
  })
}

function annotateTrip(
  trip: TripRow,
  properties: PropertyRow[],
  branches: SelectedBranch[],
  driveSpeed: number,
  hotelConfig: ReturnType<typeof loadConstraints> extends Promise<infer R>
    ? R extends { hotel_cost_config: infer C }
      ? C
      : never
    : never
) {
  const branch = branches.find(
    (b) => b.name.toLowerCase() === trip.branch_name.toLowerCase()
  )
  const tripProps = trip.property_ids
    .map((pid) => properties.find((p) => p.id === pid))
    .filter((p): p is PropertyRow => !!p)
  const validProps = tripProps.filter(
    (p) => p.latitude != null && p.longitude != null
  )

  // Drive miles: branch → first property, between properties in order,
  // last property → branch. We use the geographic ordering as given;
  // a TSP-optimized variant could improve this but isn't necessary
  // for the v1 hotel/fuel calc.
  let totalDriveMiles = 0
  if (branch && validProps.length > 0) {
    let prev = { lat: branch.lat, lng: branch.lng }
    for (const p of validProps) {
      totalDriveMiles += haversineMiles(prev, {
        lat: p.latitude!,
        lng: p.longitude!,
      })
      prev = { lat: p.latitude!, lng: p.longitude! }
    }
    // Return leg
    totalDriveMiles += haversineMiles(prev, { lat: branch.lat, lng: branch.lng })
  }

  // Drive time from branch to centroid (one-way) — used to determine
  // whether this is an overnight trip vs a day trip.
  let oneWayHours = 0
  if (branch && validProps.length > 0) {
    const lats = validProps.map((p) => p.latitude!)
    const lngs = validProps.map((p) => p.longitude!)
    const cLat = lats.reduce((s, v) => s + v, 0) / lats.length
    const cLng = lngs.reduce((s, v) => s + v, 0) / lngs.length
    const distMi = haversineMiles(
      { lat: branch.lat, lng: branch.lng },
      { lat: cLat, lng: cLng }
    )
    oneWayHours = driveTimeMinutes(distMi, driveSpeed) / 60
  }

  // Nights: 0 if day-trip distance (under hotelConfig.overnight_trigger);
  // otherwise count of properties in trip (each takes a day, with the
  // "1 building/day" rule). A more sophisticated version would account
  // for crew_size + work_hours; v1 keeps it simple and explicit.
  const isOvernight =
    oneWayHours > (hotelConfig?.overnight_trigger_one_way_hours ?? 3)
  const nightsPerTrip = isOvernight ? Math.max(1, validProps.length) : 0
  const annualNights = nightsPerTrip * Math.max(1, trip.visits_per_year ?? 1)
  const annualMiles = totalDriveMiles * Math.max(1, trip.visits_per_year ?? 1)

  const costPerNight = hotelConfig?.cost_per_night ?? 0
  const perDiemPerNight = hotelConfig?.per_diem_per_night ?? 0
  // Crew size for per-diem comes from constraints; assume 3 if not set.
  const crewSize = 3
  const includePerDiem = hotelConfig?.include_per_diem !== false
  const annualHotelCost = annualNights * costPerNight
  const annualPerDiemCost = includePerDiem
    ? annualNights * crewSize * perDiemPerNight
    : 0
  const annualLodgingCost = annualHotelCost + annualPerDiemCost

  return {
    ...trip,
    property_count: tripProps.length,
    properties_missing_coords: tripProps.length - validProps.length,
    miles_per_trip: Math.round(totalDriveMiles * 10) / 10,
    annual_miles: Math.round(annualMiles * 10) / 10,
    one_way_drive_hours_to_centroid: Math.round(oneWayHours * 100) / 100,
    is_overnight: isOvernight,
    nights_per_trip: nightsPerTrip,
    annual_nights: annualNights,
    annual_hotel_cost: Math.round(annualHotelCost),
    annual_per_diem_cost: Math.round(annualPerDiemCost),
    annual_lodging_cost: Math.round(annualLodgingCost),
  }
}
