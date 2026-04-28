import type { SupabaseClient } from '@supabase/supabase-js'
import { getCountyFips } from './fips'
import { mapRegridFields } from './fieldMapper'

const REGRID_API_COST_USD = parseFloat(process.env.REGRID_API_COST_USD ?? '0.05')
const FALLBACK_THRESHOLD = parseInt(process.env.PARCEL_FALLBACK_THRESHOLD ?? '50', 10)

export interface ParcelData {
  parcel_id?: string
  parcel_polygon?: Record<string, unknown>
  building_sqft?: number
  lot_sqft?: number
  year_built?: number
  zoning_code?: string
  land_use_code?: string
  owner_name?: string
  owner_mailing_address?: string
}

export interface ParcelLookupResult {
  source: 'local' | 'api' | 'none'
  parcel_data: ParcelData | null
  cost_usd: number
}

export interface ParcelLookupConfig {
  db: SupabaseClient
  regridApiKey: string
  propertyId: string
}

export async function parcelLookup(
  lat: number,
  lng: number,
  config: ParcelLookupConfig
): Promise<ParcelLookupResult> {
  const { db, regridApiKey, propertyId } = config

  // Step 3a.1 — Census FIPS lookup (cached)
  const fipsResult = await getCountyFips(lat, lng, db)

  if (!fipsResult) {
    // Census API failed — go straight to API fallback per spec
    console.warn(`[parcelLookup] FIPS lookup failed for (${lat},${lng}); using API fallback`)
    return callRegridApi(lat, lng, null, propertyId, db, regridApiKey)
  }

  const { county_fips, county_name, state } = fipsResult

  // Step 3a.2 — Check if we have local data for this county
  const { count } = await db
    .from('parcels')
    .select('id', { count: 'exact', head: true })
    .eq('county_fips', county_fips)
    .limit(1)

  if (!count) {
    // County not purchased — use API fallback
    return callRegridApi(lat, lng, fipsResult, propertyId, db, regridApiKey)
  }

  // Step 3a.3 — Spatial query: try Supabase RPC (find_nearest_parcel) first
  const parcel = await findNearestParcelLocal(lat, lng, county_fips, db)

  if (parcel) {
    return {
      source: 'local',
      cost_usd: 0,
      parcel_data: {
        parcel_id: parcel.id,
        parcel_polygon: parcel.geometry ?? undefined,
        building_sqft: parcel.building_sqft ?? undefined,
        lot_sqft: parcel.lot_sqft ?? undefined,
        year_built: parcel.year_built ?? undefined,
        zoning_code: parcel.zoning_code ?? undefined,
        land_use_code: parcel.land_use_code ?? undefined,
        owner_name: parcel.owner_name ?? undefined,
        owner_mailing_address: parcel.owner_mailing_address ?? undefined,
      },
    }
  }

  // Step 3b — County purchased but no match within 100m — do NOT call API
  console.info(
    `[parcelLookup] No parcel match within 100m for (${lat},${lng}) in ${county_fips}; local miss`
  )
  return { source: 'none', parcel_data: null, cost_usd: 0 }
}

// ─── local spatial query ─────────────────────────────────────────────────────

async function findNearestParcelLocal(
  lat: number,
  lng: number,
  countyFips: string,
  db: SupabaseClient
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any> | null> {
  // Try the Postgres RPC first (uses the Haversine SQL function)
  const { data: rpcRows, error: rpcErr } = await db.rpc('find_nearest_parcel', {
    p_county_fips: countyFips,
    p_lat: lat,
    p_lng: lng,
    p_max_distance_m: 100,
  })

  if (!rpcErr && rpcRows?.length) {
    return rpcRows[0]
  }

  // JS-side fallback: bounding-box query + Haversine filter
  const deltaLat = 100 / 111320
  const deltaLng = 100 / (111320 * Math.cos((lat * Math.PI) / 180))

  const { data: candidates } = await db
    .from('parcels')
    .select('*')
    .eq('county_fips', countyFips)
    .gte('centroid_lat', lat - deltaLat)
    .lte('centroid_lat', lat + deltaLat)
    .gte('centroid_lng', lng - deltaLng)
    .lte('centroid_lng', lng + deltaLng)

  if (!candidates?.length) return null

  let best: (typeof candidates)[number] | null = null
  let bestDist = Infinity

  for (const row of candidates) {
    if (row.centroid_lat == null || row.centroid_lng == null) continue
    const d = haversineMeters(lat, lng, row.centroid_lat, row.centroid_lng)
    if (d < bestDist) {
      bestDist = d
      best = row
    }
  }

  return bestDist <= 100 ? best : null
}

// ─── Regrid API fallback (Step 3c) ───────────────────────────────────────────

async function callRegridApi(
  lat: number,
  lng: number,
  fipsResult: { county_fips: string; county_name: string; state: string } | null,
  propertyId: string,
  db: SupabaseClient,
  regridApiKey: string
): Promise<ParcelLookupResult> {
  if (!regridApiKey) {
    return { source: 'none', parcel_data: null, cost_usd: 0 }
  }

  try {
    const url =
      `https://app.regrid.com/api/v2/parcels/point` +
      `?lat=${lat}&lon=${lng}&token=${regridApiKey}`

    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })

    if (!res.ok) {
      throw new Error(`Regrid API ${res.status}`)
    }

    const data = await res.json()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const features: any[] = data?.parcels?.features ?? data?.features ?? []

    await logFallback(propertyId, fipsResult, data, REGRID_API_COST_USD, db)
    void checkAndNotifyThreshold(fipsResult, db).catch(() => {})

    if (!features.length) {
      return { source: 'api', parcel_data: null, cost_usd: REGRID_API_COST_USD }
    }

    const feature = features[0]
    const rawFields = feature.properties?.fields ?? feature.properties ?? {}
    const mapped = mapRegridFields(rawFields)

    const countyFips =
      fipsResult?.county_fips ?? String(rawFields.county_fips ?? rawFields.fips ?? '')
    const countyName = fipsResult?.county_name ?? String(rawFields.county ?? '')
    const stateAbbr = fipsResult?.state ?? String(rawFields.state2 ?? rawFields.state ?? '')

    // Upsert into local parcels table — every paid call, we keep
    if (countyFips) {
      const upsertPayload = {
        regrid_ll_uuid: mapped.regrid_ll_uuid ?? null,
        parcel_number: mapped.parcel_number ?? null,
        county_fips: countyFips,
        state: stateAbbr,
        county_name: countyName || null,
        geometry: feature.geometry ?? null,
        centroid_lat: computeCentroid(feature.geometry, 'lat'),
        centroid_lng: computeCentroid(feature.geometry, 'lng'),
        building_sqft: mapped.building_sqft ?? null,
        lot_sqft: mapped.lot_sqft ?? null,
        year_built: mapped.year_built ?? null,
        zoning_code: mapped.zoning_code ?? null,
        land_use_code: mapped.land_use_code ?? null,
        land_use_standardized: mapped.land_use_standardized ?? null,
        owner_name: mapped.owner_name ?? null,
        owner_mailing_address: mapped.owner_mailing_address ?? null,
        source_refresh_date: new Date().toISOString().split('T')[0],
      }

      if (mapped.regrid_ll_uuid) {
        await db
          .from('parcels')
          .upsert(upsertPayload, { onConflict: 'regrid_ll_uuid' })
      } else {
        await db.from('parcels').insert(upsertPayload)
      }
    }

    // Resolve saved parcel ID
    let parcelId: string | undefined
    if (mapped.regrid_ll_uuid) {
      const { data: saved } = await db
        .from('parcels')
        .select('id')
        .eq('regrid_ll_uuid', mapped.regrid_ll_uuid)
        .maybeSingle()
      parcelId = saved?.id
    }

    return {
      source: 'api',
      cost_usd: REGRID_API_COST_USD,
      parcel_data: {
        parcel_id: parcelId,
        parcel_polygon: feature.geometry ?? undefined,
        building_sqft: mapped.building_sqft,
        lot_sqft: mapped.lot_sqft,
        year_built: mapped.year_built,
        zoning_code: mapped.zoning_code,
        land_use_code: mapped.land_use_code,
        owner_name: mapped.owner_name,
        owner_mailing_address: mapped.owner_mailing_address,
      },
    }
  } catch (err) {
    console.error('[parcelLookup] Regrid API call failed:', err)
    return { source: 'none', parcel_data: null, cost_usd: 0 }
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function logFallback(
  propertyId: string,
  fipsResult: { county_fips: string; county_name: string; state: string } | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiResponse: any,
  cost: number,
  db: SupabaseClient
) {
  await db.from('parcel_api_fallbacks').insert({
    property_id: propertyId || null,
    county_fips: fipsResult?.county_fips ?? null,
    county_name: fipsResult?.county_name ?? null,
    state: fipsResult?.state ?? null,
    api_response: apiResponse,
    api_cost_usd: cost,
  })
}

async function checkAndNotifyThreshold(
  fipsResult: { county_fips: string; county_name: string; state: string } | null,
  db: SupabaseClient
) {
  if (!fipsResult) return

  const { county_fips, county_name, state } = fipsResult
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  const { count } = await db
    .from('parcel_api_fallbacks')
    .select('id', { count: 'exact', head: true })
    .eq('county_fips', county_fips)
    .gte('called_at', ninetyDaysAgo)

  if (!count || count < FALLBACK_THRESHOLD) return

  // Check 30-day dedup
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { count: recent } = await db
    .from('parcel_notification_log')
    .select('id', { count: 'exact', head: true })
    .eq('county_fips', county_fips)
    .gte('notified_at', thirtyDaysAgo)

  if (recent && recent > 0) return

  const email = process.env.ADMIN_NOTIFICATION_EMAIL
  if (email) {
    try {
      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)
      await resend.emails.send({
        from: 'RBM Geo <noreply@rbm-geo.com>',
        to: email,
        subject: `[RBM Geo] Buy county alert: ${county_name ?? county_fips} (${state})`,
        html: `
          <p>County <strong>${county_name ?? county_fips}</strong> (${state}) has exceeded
          ${FALLBACK_THRESHOLD} Regrid API fallback calls in the last 90 days.</p>
          <p>Consider purchasing parcel data for this county from the Regrid Data Store
          to eliminate ongoing API costs.</p>
          <p><a href="${process.env.PUBLIC_URL ?? ''}/admin/parcels/fallbacks">View dashboard</a></p>
        `,
      })
    } catch (err) {
      console.error('[parcelLookup] Notification email failed:', err)
    }
  }

  await db.from('parcel_notification_log').insert({
    county_fips,
    county_name: county_name || null,
    state: state || null,
    threshold_crossed: FALLBACK_THRESHOLD,
  })
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

function computeCentroid(
  geom: { type: string; coordinates: number[][][] } | null,
  axis: 'lat' | 'lng'
): number | null {
  if (!geom || geom.type !== 'Polygon' || !geom.coordinates?.[0]?.length) return null
  const coords = geom.coordinates[0]
  const idx = axis === 'lat' ? 1 : 0
  return coords.reduce((s, c) => s + c[idx], 0) / coords.length
}
