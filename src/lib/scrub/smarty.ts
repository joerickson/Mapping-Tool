import type { ValidatedAddress } from './scrubAddress'

export interface SmartyResult {
  verified: boolean
  standardized?: ValidatedAddress
  raw: unknown
}

interface SmartyUsCandidate {
  delivery_line_1?: string
  last_line?: string
  components?: {
    city_name?: string
    state_abbreviation?: string
    zipcode?: string
    plus4_code?: string
  }
}

interface SmartyIntlCandidate {
  organization?: string
  address1?: string
  address2?: string
  address3?: string
  address4?: string
  address5?: string
  components?: {
    locality?: string
    administrative_area?: string
    postal_code?: string
    country_iso_3?: string
  }
}

export async function smartyVerifyUs(
  address: ValidatedAddress,
  authId: string,
  authToken: string,
): Promise<SmartyResult> {
  const params = new URLSearchParams({
    'auth-id': authId,
    'auth-token': authToken,
    street: address.address_line1,
    ...(address.address_line2 ? { street2: address.address_line2 } : {}),
    city: address.city,
    state: address.state,
    zipcode: address.postal_code,
    candidates: '1',
  })

  const url = `https://us-street.api.smarty.com/street-address?${params}`
  const res = await fetch(url)
  if (!res.ok) {
    return { verified: false, raw: { error: `HTTP ${res.status}` } }
  }

  const data: SmartyUsCandidate[] = await res.json()
  if (!data || data.length === 0) {
    return { verified: false, raw: data }
  }

  const c = data[0]
  const zip = c.components?.zipcode
    ? c.components.plus4_code
      ? `${c.components.zipcode}-${c.components.plus4_code}`
      : c.components.zipcode
    : address.postal_code

  const standardized: ValidatedAddress = {
    address_line1: c.delivery_line_1 ?? address.address_line1,
    city: c.components?.city_name ?? address.city,
    state: c.components?.state_abbreviation ?? address.state,
    postal_code: zip,
    country: 'US',
  }

  return { verified: true, standardized, raw: data }
}

export async function smartyVerifyInternational(
  address: ValidatedAddress,
  authId: string,
  authToken: string,
): Promise<SmartyResult> {
  const params = new URLSearchParams({
    'auth-id': authId,
    'auth-token': authToken,
    address1: address.address_line1,
    ...(address.address_line2 ? { address2: address.address_line2 } : {}),
    locality: address.city,
    administrative_area: address.state,
    postal_code: address.postal_code,
    country: address.country,
    geocode: 'false',
  })

  const url = `https://international-street.api.smarty.com/verify?${params}`
  const res = await fetch(url)
  if (!res.ok) {
    return { verified: false, raw: { error: `HTTP ${res.status}` } }
  }

  const data: SmartyIntlCandidate[] = await res.json()
  if (!data || data.length === 0) {
    return { verified: false, raw: data }
  }

  const c = data[0]
  const standardized: ValidatedAddress = {
    address_line1: c.address1 ?? address.address_line1,
    ...(c.address2 ? { address_line2: c.address2 } : {}),
    city: c.components?.locality ?? address.city,
    state: c.components?.administrative_area ?? address.state,
    postal_code: c.components?.postal_code ?? address.postal_code,
    country: address.country,
  }

  return { verified: true, standardized, raw: data }
}
