interface AddressInput {
  address_line1: string
  address_line2?: string | null
  city: string
  state: string
  postal_code: string
  country: string
}

interface ValidationResult {
  verdict: 'CONFIRMED' | 'CONFIRMED_WITH_CORRECTIONS' | 'UNCONFIRMED' | 'UNCONFIRMED_BUT_PLAUSIBLE' | 'INFERRED'
  validated: AddressInput
  formatted_address: string
  raw_response: any
}

interface GeocodeResult {
  latitude: number
  longitude: number
  source: 'google'
  confidence: 'rooftop' | 'range_interpolated' | 'geometric_center' | 'approximate'
  place_id: string | null
  formatted_address: string
}

function getApiKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY is not set')
  return key
}

// Maps Google's validationGranularity to our verdict enum
function mapGranularityToVerdict(
  granularity: string,
  hasUnconfirmedComponents: boolean
): ValidationResult['verdict'] {
  switch (granularity) {
    case 'PREMISE':
    case 'SUB_PREMISE':
      return hasUnconfirmedComponents ? 'CONFIRMED_WITH_CORRECTIONS' : 'CONFIRMED'
    case 'PREMISE_PROXIMITY':
      return 'UNCONFIRMED_BUT_PLAUSIBLE'
    case 'BLOCK':
    case 'ROUTE':
      return 'INFERRED'
    default:
      return 'UNCONFIRMED'
  }
}

export async function validateAddress(input: AddressInput): Promise<ValidationResult | null> {
  const key = getApiKey()

  const addressLines = [input.address_line1]
  if (input.address_line2) addressLines.push(input.address_line2)

  const body = {
    address: {
      regionCode: input.country || 'US',
      addressLines,
      locality: input.city,
      administrativeArea: input.state,
      postalCode: input.postal_code,
    },
  }

  const resp = await fetch(
    `https://addressvalidation.googleapis.com/v1:validateAddress?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Address Validation API error ${resp.status}: ${text}`)
  }

  const data = await resp.json()
  const result = data?.result
  if (!result) return null

  const granularity: string = result.verdict?.validationGranularity ?? 'OTHER'
  const hasUnconfirmed = !!(result.verdict?.hasUnconfirmedComponents)
  const verdict = mapGranularityToVerdict(granularity, hasUnconfirmed)

  const postalAddress = result.address?.postalAddress ?? {}
  const addressLineOut: string[] = postalAddress.addressLines ?? addressLines

  const validated: AddressInput = {
    address_line1: addressLineOut[0] ?? input.address_line1,
    address_line2: addressLineOut[1] ?? input.address_line2 ?? null,
    city: postalAddress.locality ?? input.city,
    state: postalAddress.administrativeArea ?? input.state,
    postal_code: postalAddress.postalCode ?? input.postal_code,
    country: postalAddress.regionCode ?? input.country,
  }

  return {
    verdict,
    validated,
    formatted_address: result.address?.formattedAddress ?? addressLineOut.join(', '),
    raw_response: data,
  }
}

export async function geocodeAddress(input: AddressInput): Promise<GeocodeResult | null> {
  const key = getApiKey()

  const parts = [input.address_line1]
  if (input.address_line2) parts.push(input.address_line2)
  parts.push(input.city, input.state, input.postal_code)
  const addressStr = encodeURIComponent(parts.join(', '))

  const resp = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${addressStr}&key=${key}`
  )

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Geocoding API HTTP error ${resp.status}: ${text}`)
  }

  const data = await resp.json()

  if (data.status === 'ZERO_RESULTS') return null
  if (data.status === 'OVER_QUERY_LIMIT') {
    throw new Error('Geocoding API rate limit exceeded (OVER_QUERY_LIMIT). Retry later.')
  }
  if (data.status !== 'OK') {
    throw new Error(`Geocoding API error: ${data.status} — ${data.error_message ?? ''}`)
  }

  const top = data.results?.[0]
  if (!top) return null

  const locType: string = top.geometry?.location_type ?? ''
  const confidenceMap: Record<string, GeocodeResult['confidence']> = {
    ROOFTOP: 'rooftop',
    RANGE_INTERPOLATED: 'range_interpolated',
    GEOMETRIC_CENTER: 'geometric_center',
    APPROXIMATE: 'approximate',
  }
  const confidence: GeocodeResult['confidence'] = confidenceMap[locType] ?? 'approximate'

  return {
    latitude: top.geometry.location.lat,
    longitude: top.geometry.location.lng,
    source: 'google',
    confidence,
    place_id: top.place_id ?? null,
    formatted_address: top.formatted_address ?? '',
  }
}
