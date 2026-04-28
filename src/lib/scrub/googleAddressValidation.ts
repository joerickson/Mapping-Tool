import type { ValidatedAddress } from './scrubAddress'

export const GOOGLE_ADDRESS_VALIDATION_COST_USD = 0.017

export type ValidationGranularity =
  | 'PREMISE'
  | 'SUB_PREMISE'
  | 'PREMISE_PROXIMITY'
  | 'BLOCK'
  | 'ROUTE'
  | 'OTHER'

const GRANULARITY_CONFIDENCE: Record<ValidationGranularity, number> = {
  PREMISE: 1.0,
  SUB_PREMISE: 1.0,
  PREMISE_PROXIMITY: 0.9,
  BLOCK: 0.7,
  ROUTE: 0.5,
  OTHER: 0.3,
}

export function granularityConfidence(g: ValidationGranularity | string): number {
  return (GRANULARITY_CONFIDENCE as Record<string, number>)[g] ?? 0.3
}

interface GoogleValidationApiResponse {
  result?: {
    verdict?: {
      validationGranularity?: ValidationGranularity
      addressComplete?: boolean
      hasUnconfirmedComponents?: boolean
      hasInferredComponents?: boolean
    }
    address?: {
      formattedAddress?: string
      postalAddress?: Record<string, unknown>
    }
    geocode?: {
      location?: {
        latitude: number
        longitude: number
      }
    }
    uspsData?: {
      dpvConfirmation?: string
      [key: string]: unknown
    }
  }
}

export interface GoogleValidationResult {
  granularity: ValidationGranularity
  addressComplete: boolean
  hasUnconfirmedComponents: boolean
  hasInferredComponents: boolean
  postalAddress: unknown
  latitude?: number
  longitude?: number
  geocodedAt?: string
  uspsVerified: boolean
  uspsResponse: unknown
}

export async function googleValidateAddress(
  address: ValidatedAddress,
  apiKey: string,
): Promise<GoogleValidationResult | null> {
  const isUs = address.country === 'US'

  const body: Record<string, unknown> = {
    address: {
      regionCode: address.country,
      addressLines: [
        address.address_line1,
        ...(address.address_line2 ? [address.address_line2] : []),
      ],
      locality: address.city,
      administrativeArea: address.state,
      postalCode: address.postal_code,
    },
  }
  if (isUs) body.enableUspsCass = true

  let res: Response
  try {
    res = await fetch(
      `https://addressvalidation.googleapis.com/v1:validateAddress?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    )
  } catch {
    return null
  }

  if (!res.ok) return null

  let data: GoogleValidationApiResponse
  try {
    data = await res.json()
  } catch {
    return null
  }

  const result = data?.result
  if (!result?.verdict) return null

  const verdict = result.verdict
  const geocode = result.geocode?.location
  const uspsData = result.uspsData

  return {
    granularity: verdict.validationGranularity ?? 'OTHER',
    addressComplete: verdict.addressComplete ?? false,
    hasUnconfirmedComponents: verdict.hasUnconfirmedComponents ?? false,
    hasInferredComponents: verdict.hasInferredComponents ?? false,
    postalAddress: result.address?.postalAddress ?? null,
    ...(geocode
      ? {
          latitude: geocode.latitude,
          longitude: geocode.longitude,
          geocodedAt: new Date().toISOString(),
        }
      : {}),
    uspsVerified: uspsData?.dpvConfirmation === 'Y',
    uspsResponse: result,
  }
}
