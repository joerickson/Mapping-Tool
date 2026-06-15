import crypto from 'crypto'

// Replicates the normalization + dedupe-hash logic in
// supabase/functions/process-upload-batch/index.ts so that rows edited after a
// failed commit dedupe identically to the original import. Keep the two copies
// in sync until they are unified (the edge function runs on Deno).

const COUNTRY_ALIASES: Record<string, string> = {
  us: 'US', usa: 'US', 'united states': 'US', 'united states of america': 'US', america: 'US',
  ca: 'CA', can: 'CA', canada: 'CA',
  mx: 'MX', mex: 'MX', mexico: 'MX',
}

export function normalizeCountry(raw: string): string | null {
  return COUNTRY_ALIASES[raw.toLowerCase().trim()] ?? null
}

const US_STATE_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS',
  kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA',
  michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC',
}

const CA_PROVINCE_NAMES: Record<string, string> = {
  alberta: 'AB', 'british columbia': 'BC', manitoba: 'MB', 'new brunswick': 'NB',
  newfoundland: 'NL', 'nova scotia': 'NS', ontario: 'ON', 'prince edward island': 'PE',
  quebec: 'QC', 'québec': 'QC', saskatchewan: 'SK', yukon: 'YT',
}

export function normalizeState(state: string, country: string): { value: string; corrected: boolean } {
  const up = state.toUpperCase().trim()
  const low = state.toLowerCase().trim()
  if (country === 'CA') {
    const fromName = CA_PROVINCE_NAMES[low]
    if (fromName) return { value: fromName, corrected: true }
    return { value: up, corrected: up !== state.trim() }
  }
  const fromName = US_STATE_NAMES[low]
  if (fromName) return { value: fromName, corrected: true }
  return { value: up, corrected: up !== state.trim() }
}

export function normalizePostal(postal: string, country: string): { value: string; corrected: boolean } {
  if (country === 'US') {
    const pc = postal.replace(/\.0+$/, '')
    if (/^\d{9}$/.test(pc)) return { value: `${pc.slice(0, 5)}-${pc.slice(5)}`, corrected: true }
    if (/^\d{5}(-\d{4})?$/.test(pc)) return { value: pc, corrected: pc !== postal }
    return { value: postal, corrected: false }
  }
  if (country === 'CA') {
    let pc = postal.toUpperCase().replace(/\s/g, '')
    if (pc.length !== 6) return { value: postal, corrected: false }
    let oFixed = false
    for (const idx of [1, 3, 5]) {
      if (pc[idx] === 'O') { pc = pc.slice(0, idx) + '0' + pc.slice(idx + 1); oFixed = true }
    }
    const formatted = `${pc.slice(0, 3)} ${pc.slice(3)}`
    return { value: formatted, corrected: formatted !== postal || oFixed }
  }
  return { value: postal, corrected: false }
}

export function computeDedupeHash(addr1: string, city: string, state: string, postal: string): string {
  const msg = [addr1, city, state, postal.slice(0, 5)]
    .map((s) => s.toLowerCase().trim().replace(/\s+/g, ' '))
    .join('|')
  return crypto.createHash('sha256').update(msg).digest('hex')
}

export interface NormalizedAddress {
  address_line1: string
  address_line2: string | null
  city: string
  state: string
  postal_code: string
  country: string
}

export function normalizeAddress(input: {
  address_line1?: unknown
  address_line2?: unknown
  city?: unknown
  state?: unknown
  postal_code?: unknown
  country?: unknown
}): NormalizedAddress {
  const addr1 = String(input.address_line1 ?? '').trim()
  const addr2 = String(input.address_line2 ?? '').trim()
  const city = String(input.city ?? '').trim()
  const stateRaw = String(input.state ?? '').trim()
  const postalRaw = String(input.postal_code ?? '').trim()
  const countryRaw = String(input.country ?? '').trim()

  const country = countryRaw ? (normalizeCountry(countryRaw) ?? countryRaw) : 'US'
  const state = stateRaw ? normalizeState(stateRaw, country).value : ''
  const postal_code = postalRaw ? normalizePostal(postalRaw, country).value : ''

  return {
    address_line1: addr1,
    address_line2: addr2 || null,
    city,
    state,
    postal_code,
    country,
  }
}
