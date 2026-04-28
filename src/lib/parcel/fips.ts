import type { SupabaseClient } from '@supabase/supabase-js'

export interface FipsResult {
  county_fips: string
  county_name: string
  state: string
}

const CENSUS_GEOCODER =
  'https://geocoding.geo.census.gov/geocoder/geographies/coordinates'

export async function getCountyFips(
  lat: number,
  lng: number,
  db: SupabaseClient
): Promise<FipsResult | null> {
  // Round to 4 decimal places (~11m precision) for cache key
  const latKey = Math.round(lat * 10000) / 10000
  const lngKey = Math.round(lng * 10000) / 10000

  const { data: cached } = await db
    .from('geo_county_cache')
    .select('county_fips, county_name, state')
    .eq('lat_key', latKey)
    .eq('lng_key', lngKey)
    .maybeSingle()

  if (cached) {
    return { county_fips: cached.county_fips, county_name: cached.county_name ?? '', state: cached.state ?? '' }
  }

  try {
    const url =
      `${CENSUS_GEOCODER}?x=${lng}&y=${lat}` +
      `&benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties&format=json`

    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null

    const data = await res.json()
    const counties: Record<string, string>[] | undefined =
      data?.result?.geographies?.Counties
    if (!counties?.length) return null

    const county = counties[0]
    const fips = (county.STATE ?? '') + (county.COUNTY ?? '')
    const name = county.NAME ?? ''
    const state = county.STUSAB ?? ''

    await db
      .from('geo_county_cache')
      .upsert(
        { lat_key: latKey, lng_key: lngKey, county_fips: fips, county_name: name, state },
        { onConflict: 'lat_key,lng_key' }
      )

    return { county_fips: fips, county_name: name, state }
  } catch {
    return null
  }
}
