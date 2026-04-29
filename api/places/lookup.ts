// GET /api/places/lookup?q=<text>
// Lightweight server-side wrapper around Google Geocoding so the dashboard
// can build an autocomplete picker without exposing the API key client-side.
// Returns up to 5 matches, each with a clean { name, formatted, city, state,
// lat, lng } shape suitable for filling a "set location" form.
//
// Uses Geocoding (not Places Autocomplete) to avoid the place_id round-trip:
// Geocoding accepts free-form text and returns lat/lng directly. The trade-off
// is no live "as you type" suggestions for partial words — but for branch
// office addresses ("Frisco TX", "1234 Main St Houston TX"), it works well
// once the user finishes typing a city or full address.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authenticateRequest } from '../_lib/auth.js'

interface PlacesMatch {
  formatted: string
  name: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  lat: number
  lng: number
  place_id: string | null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const q = (req.query.q as string | undefined)?.trim() ?? ''
  if (q.length < 2) {
    return res.status(200).json({ matches: [] })
  }

  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) {
    return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY is not configured' })
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    q
  )}&components=country:US&key=${key}`

  try {
    const resp = await fetch(url)
    if (!resp.ok) return res.status(502).json({ error: `Geocoder HTTP ${resp.status}` })
    const data = await resp.json()
    if (data.status === 'ZERO_RESULTS') return res.status(200).json({ matches: [] })
    if (data.status !== 'OK') {
      return res.status(502).json({
        error: `Geocoder returned ${data.status}: ${data.error_message ?? ''}`,
      })
    }

    const matches: PlacesMatch[] = (data.results ?? []).slice(0, 5).map((r: any) => {
      const components = (r.address_components ?? []) as Array<{
        long_name: string
        short_name: string
        types: string[]
      }>
      const find = (...types: string[]) =>
        components.find((c) => types.some((t) => c.types.includes(t))) ?? null
      const cityComp =
        find('locality') ??
        find('postal_town') ??
        find('sublocality') ??
        find('administrative_area_level_3') ??
        find('neighborhood') ??
        find('administrative_area_level_2')
      const stateComp = find('administrative_area_level_1')
      const postalComp = find('postal_code')
      return {
        formatted: r.formatted_address ?? '',
        name: cityComp?.long_name ?? null,
        city: cityComp?.short_name ?? cityComp?.long_name ?? null,
        state: stateComp?.short_name ?? stateComp?.long_name ?? null,
        postal_code: postalComp?.short_name ?? null,
        lat: r.geometry?.location?.lat ?? 0,
        lng: r.geometry?.location?.lng ?? 0,
        place_id: r.place_id ?? null,
      }
    })

    return res.status(200).json({ matches })
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? String(err) })
  }
}
