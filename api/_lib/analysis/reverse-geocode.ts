// Thin wrapper around Google Geocoding API for centroid → "City, ST" lookups.
// Used by the Branch Optimization module. Errors are non-fatal — fall back to
// "Unknown" if the API fails so the analysis can still complete.

interface ReverseGeocodeResult {
  city: string | null
  state: string | null
  formatted: string
}

function getApiKey(): string | null {
  return process.env.GOOGLE_MAPS_API_KEY ?? null
}

export async function reverseGeocodeCityState(
  lat: number,
  lng: number
): Promise<ReverseGeocodeResult> {
  const key = getApiKey()
  if (!key) {
    return { city: null, state: null, formatted: 'Unknown location' }
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&result_type=locality|administrative_area_level_3&key=${key}`

  try {
    const resp = await fetch(url)
    if (!resp.ok) return { city: null, state: null, formatted: 'Unknown location' }
    const data = await resp.json()
    if (data.status !== 'OK' || !data.results?.length) {
      return { city: null, state: null, formatted: `${lat.toFixed(3)}, ${lng.toFixed(3)}` }
    }

    let city: string | null = null
    let state: string | null = null
    for (const comp of data.results[0].address_components ?? []) {
      const types: string[] = comp.types ?? []
      if (!city && (types.includes('locality') || types.includes('administrative_area_level_3'))) {
        city = comp.short_name ?? comp.long_name
      }
      if (!state && types.includes('administrative_area_level_1')) {
        state = comp.short_name ?? comp.long_name
      }
    }

    const formatted = city && state ? `${city}, ${state}` : data.results[0].formatted_address
    return { city, state, formatted }
  } catch {
    return { city: null, state: null, formatted: 'Unknown location' }
  }
}
