// Thin wrapper around Google Geocoding API for centroid → "City, ST" lookups.
// Used by the Branch Optimization module. Errors are non-fatal — fall back
// gracefully so the analysis can still complete.
//
// We don't filter the geocode query by result_type. The previous version
// pinned result_type to locality|administrative_area_level_3, which works for
// urban centroids but returns ZERO_RESULTS when the centroid lands in a rural
// gap or unincorporated area — the fallback string was bare lat/lng, which
// users can't read. Loosening the query lets Google return *any* result for
// the point; we then scan address_components in priority order (city >
// neighborhood/town > county) and emit a label that always names a place.

interface ReverseGeocodeResult {
  city: string | null
  state: string | null
  formatted: string
}

function getApiKey(): string | null {
  return process.env.GOOGLE_MAPS_API_KEY ?? null
}

// Address-component types in decreasing order of "city-ness". The first match
// wins for the city slot.
const CITY_COMPONENT_TYPES = [
  'locality',                       // most US cities
  'postal_town',                    // some non-US localities
  'sublocality',                    // boroughs/neighborhoods, when no locality
  'administrative_area_level_3',    // township in some states
  'neighborhood',                   // last resort
  'administrative_area_level_2',    // county — better than coordinates
]

function pickCityFromComponents(components: any[]): string | null {
  for (const wantedType of CITY_COMPONENT_TYPES) {
    const match = components.find((c: any) => (c.types ?? []).includes(wantedType))
    if (match) return match.short_name ?? match.long_name ?? null
  }
  return null
}

function pickStateFromComponents(components: any[]): string | null {
  const match = components.find((c: any) =>
    (c.types ?? []).includes('administrative_area_level_1')
  )
  return match ? match.short_name ?? match.long_name ?? null : null
}

export async function reverseGeocodeCityState(
  lat: number,
  lng: number
): Promise<ReverseGeocodeResult> {
  const key = getApiKey()
  if (!key) {
    return { city: null, state: null, formatted: `Approx. ${lat.toFixed(3)}, ${lng.toFixed(3)}` }
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${key}`

  try {
    const resp = await fetch(url)
    if (!resp.ok) {
      return { city: null, state: null, formatted: `Approx. ${lat.toFixed(3)}, ${lng.toFixed(3)}` }
    }
    const data = await resp.json()
    if (data.status !== 'OK' || !data.results?.length) {
      return { city: null, state: null, formatted: `Approx. ${lat.toFixed(3)}, ${lng.toFixed(3)}` }
    }

    // Scan all results' components — the first result is often a precise
    // address, so picking from any result lets us prefer city-level types.
    let city: string | null = null
    let state: string | null = null
    for (const result of data.results) {
      const components = result.address_components ?? []
      if (!city) city = pickCityFromComponents(components)
      if (!state) state = pickStateFromComponents(components)
      if (city && state) break
    }

    if (city && state) return { city, state, formatted: `${city}, ${state}` }

    // Fall back to the first result's formatted_address (a real human-readable
    // string from Google), trimmed to the city/state portion when possible.
    const firstFormatted: string = data.results[0].formatted_address ?? ''
    if (firstFormatted) {
      // Try to trim "1234 Main St, City, ST 12345, USA" → "City, ST"
      const parts = firstFormatted.split(',').map((s: string) => s.trim())
      if (parts.length >= 3) {
        const cityPart = parts[parts.length - 3]
        const stateZip = parts[parts.length - 2] // "ST 12345"
        const stateMatch = /^([A-Z]{2})\b/.exec(stateZip)
        if (stateMatch) return { city: cityPart, state: stateMatch[1], formatted: `${cityPart}, ${stateMatch[1]}` }
      }
      return { city, state, formatted: firstFormatted }
    }

    return {
      city,
      state,
      formatted: `Approx. ${lat.toFixed(3)}, ${lng.toFixed(3)}`,
    }
  } catch {
    return {
      city: null,
      state: null,
      formatted: `Approx. ${lat.toFixed(3)}, ${lng.toFixed(3)}`,
    }
  }
}
