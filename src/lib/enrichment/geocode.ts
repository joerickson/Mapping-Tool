import type { Property } from '../../types'

export interface GeocodeResult {
  latitude: number
  longitude: number
  geocode_confidence: 'rooftop' | 'range_interpolated' | 'approximate'
  geocode_source: 'google' | 'google_address_validation'
  geocoded_at: string
}

function normalizeAddress(p: Pick<Property, 'address_line1' | 'city' | 'state' | 'postal_code'>): string {
  return [p.address_line1, p.city, p.state, p.postal_code]
    .map((s) => s.trim().toLowerCase().replace(/\s+/g, ' '))
    .join('|')
}

export function addressHash(p: Pick<Property, 'address_line1' | 'city' | 'state' | 'postal_code'>): string {
  const normalized = normalizeAddress(p)
  // Simple hash — replace with crypto.createHash in server context
  let hash = 0
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

const LOCATION_TYPE_MAP: Record<string, GeocodeResult['geocode_confidence']> = {
  ROOFTOP: 'rooftop',
  RANGE_INTERPOLATED: 'range_interpolated',
  GEOMETRIC_CENTER: 'approximate',
  APPROXIMATE: 'approximate',
}

export async function geocodeAddress(
  address: string,
  apiKey: string
): Promise<GeocodeResult | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) return null

  const data = await res.json()
  if (data.status !== 'OK' || !data.results?.length) return null

  const result = data.results[0]
  const loc = result.geometry.location

  return {
    latitude: loc.lat,
    longitude: loc.lng,
    geocode_confidence: LOCATION_TYPE_MAP[result.geometry.location_type] ?? 'approximate',
    geocode_source: 'google',
    geocoded_at: new Date().toISOString(),
  }
}

export async function geocodeBatch(
  properties: Pick<Property, 'property_id' | 'address_line1' | 'city' | 'state' | 'postal_code'>[],
  apiKey: string,
  concurrency = 5
): Promise<Map<string, GeocodeResult | null>> {
  const results = new Map<string, GeocodeResult | null>()

  for (let i = 0; i < properties.length; i += concurrency) {
    const batch = properties.slice(i, i + concurrency)
    const resolved = await Promise.all(
      batch.map(async (p) => {
        const addr = `${p.address_line1}, ${p.city}, ${p.state} ${p.postal_code}`
        const result = await geocodeAddress(addr, apiKey)
        return { id: p.property_id, result }
      })
    )
    resolved.forEach(({ id, result }) => results.set(id, result))
    // Rate limit: ~50 req/sec max for Google
    if (i + concurrency < properties.length) {
      await new Promise((r) => setTimeout(r, 200))
    }
  }

  return results
}
