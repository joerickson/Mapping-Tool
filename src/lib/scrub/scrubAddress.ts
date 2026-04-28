import crypto from 'crypto'
import {
  COUNTRY_MAP,
  US_STATE_MAP, US_STATE_CODES,
  CA_PROVINCE_MAP, CA_PROVINCE_CODES,
  STREET_SUFFIX_MAP, DIRECTIONALS,
} from './lookups'

export type ScrubStatus = 'clean' | 'auto_corrected' | 'needs_review' | 'rejected'

export interface Correction {
  field: string
  original: string
  corrected: string
  reason: string
  severity: 'minor' | 'major'
}

export interface ValidatedAddress {
  address_line1: string
  address_line2?: string
  city: string
  state: string
  postal_code: string
  country: string
}

export interface ScrubResult {
  status: ScrubStatus
  corrections: Correction[]
  confidence: number
  dedupe_hash: string | null
  validated_address: ValidatedAddress | null
  issues: string[]
}

export interface FieldMapping {
  address_line1: string
  address_line2?: string
  city: string
  state: string
  postal_code: string
  country?: string
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function titleCaseAddress(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((word) => {
      const up = word.toUpperCase()
      if (DIRECTIONALS.has(up)) return up
      // Preserve ordinals: 1st, 2nd, 3rd, Nth etc.
      if (/^\d+(st|nd|rd|th)$/i.test(word)) {
        return word.replace(/(st|nd|rd|th)$/i, (m) => m.toLowerCase())
      }
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')
}

function normalizeStreetSuffix(addr: string): { result: string; changed: boolean } {
  const words = addr.split(/\s+/)
  const normalized = words.map((word, i) => {
    if (i === 0) return word // never normalize the first word (could be a number)
    const trailing = word.match(/[.,]$/)?.[0] ?? ''
    const bare = word.replace(/[.,]$/, '').toLowerCase()
    const sub = STREET_SUFFIX_MAP[bare]
    if (sub) return sub + trailing
    return word
  })
  const result = normalized.join(' ')
  return { result, changed: result !== addr }
}

function normalizeUsPostal(raw: string): { result: string; changed: boolean; valid: boolean; issue?: string } {
  let pc = raw.replace(/\.0+$/, '') // strip Excel float suffix
  const origPc = pc

  if (/^\d{9}$/.test(pc)) {
    pc = `${pc.slice(0, 5)}-${pc.slice(5)}`
  } else if (/^\d{5}-\d{5,}$/.test(pc)) {
    pc = pc.slice(0, 10)
  }

  if (/^\d{5}(-\d{4})?$/.test(pc)) {
    return { result: pc, changed: pc !== raw, valid: true }
  }
  return { result: raw, changed: false, valid: false, issue: `Invalid US postal code: "${raw}"` }
}

function normalizeCaPostal(raw: string): { result: string; changed: boolean; valid: boolean; issue?: string; oSubstituted?: boolean } {
  let pc = raw.toUpperCase().replace(/\s/g, '')
  if (pc.length !== 6) {
    return { result: raw, changed: false, valid: false, issue: `Invalid Canadian postal code: "${raw}"` }
  }

  // Digit positions in A1A1A1 format: indices 1, 3, 5
  let fixed = pc
  let oSubstituted = false
  for (const idx of [1, 3, 5]) {
    if (fixed[idx] === 'O') {
      fixed = fixed.slice(0, idx) + '0' + fixed.slice(idx + 1)
      oSubstituted = true
    }
  }

  const formatted = `${fixed.slice(0, 3)} ${fixed.slice(3)}`
  if (/^[A-Z]\d[A-Z] \d[A-Z]\d$/.test(formatted)) {
    return { result: formatted, changed: formatted !== raw, valid: true, oSubstituted }
  }
  return { result: raw, changed: false, valid: false, issue: `Invalid Canadian postal code: "${raw}"` }
}

export function scrubAddress(rawRow: Record<string, unknown>, mapping: FieldMapping): ScrubResult {
  const corrections: Correction[] = []
  const issues: string[] = []
  let confidence = 1.0

  const addCorrection = (
    field: string,
    original: string,
    corrected: string,
    reason: string,
    severity: 'minor' | 'major',
  ) => {
    corrections.push({ field, original, corrected, reason, severity })
    confidence -= severity === 'minor' ? 0.1 : 0.3
  }

  const getStr = (key: string | undefined) =>
    key ? collapseWhitespace(String(rawRow[key] ?? '')) : ''

  let addr1 = getStr(mapping.address_line1)
  let addr2 = getStr(mapping.address_line2)
  let city = getStr(mapping.city)
  let state = getStr(mapping.state)
  let postalCode = getStr(mapping.postal_code)
  const rawCountry = getStr(mapping.country)

  // Step 2 — normalize country
  let country = 'US'
  if (rawCountry) {
    const mapped = COUNTRY_MAP[rawCountry.toLowerCase()]
    if (mapped) {
      if (mapped !== rawCountry) {
        addCorrection('country', rawCountry, mapped, 'Normalized country name', 'minor')
      }
      country = mapped
    } else {
      issues.push(`Unknown country: "${rawCountry}"`)
      confidence -= 0.5
    }
  }

  // Step 3 — normalize state/province
  let normalizedState = state
  if (!state) {
    issues.push('State/province is required')
    confidence -= 0.5
  } else {
    const stateUp = state.toUpperCase()
    const stateLow = state.toLowerCase()

    if (country === 'US') {
      const fromFull = US_STATE_MAP[stateLow]
      if (fromFull) {
        if (fromFull !== state) {
          addCorrection('state', state, fromFull, 'Expanded state name to 2-letter code', 'minor')
        }
        normalizedState = fromFull
      } else if (US_STATE_CODES.has(stateUp)) {
        if (stateUp !== state) {
          addCorrection('state', state, stateUp, 'Uppercased state code', 'minor')
        }
        normalizedState = stateUp
      } else {
        issues.push(`Unrecognized US state: "${state}"`)
        confidence -= 0.3
      }
    } else if (country === 'CA') {
      const fromFull = CA_PROVINCE_MAP[stateLow]
      if (fromFull) {
        if (fromFull !== state) {
          addCorrection('state', state, fromFull, 'Expanded province name to 2-letter code', 'minor')
        }
        normalizedState = fromFull
      } else if (CA_PROVINCE_CODES.has(stateUp)) {
        if (stateUp !== state) {
          addCorrection('state', state, stateUp, 'Uppercased province code', 'minor')
        }
        normalizedState = stateUp
      } else {
        issues.push(`Unrecognized Canadian province: "${state}"`)
        confidence -= 0.3
      }
    }
  }

  // Step 4 — normalize postal code
  let normalizedPostal = postalCode
  if (!postalCode) {
    issues.push('Postal code is required')
    confidence -= 0.5
  } else if (country === 'US') {
    const r = normalizeUsPostal(postalCode)
    if (r.valid) {
      if (r.changed) addCorrection('postal_code', postalCode, r.result, 'Normalized US postal code', 'minor')
      normalizedPostal = r.result
    } else {
      issues.push(r.issue!)
      confidence -= 0.5
    }
  } else if (country === 'CA') {
    const r = normalizeCaPostal(postalCode)
    if (r.valid) {
      if (r.oSubstituted) {
        addCorrection('postal_code', postalCode, r.result, 'Corrected letter O → digit 0 in Canadian postal code', 'major')
      } else if (r.changed) {
        addCorrection('postal_code', postalCode, r.result, 'Normalized Canadian postal code', 'minor')
      }
      normalizedPostal = r.result
    } else {
      issues.push(r.issue!)
      confidence -= 0.5
    }
  } else if (country === 'MX') {
    let pc = postalCode.replace(/\.0+$/, '')
    if (/^\d{5}$/.test(pc)) {
      if (pc !== postalCode) addCorrection('postal_code', postalCode, pc, 'Normalized Mexican postal code', 'minor')
      normalizedPostal = pc
    } else {
      issues.push(`Invalid Mexican postal code: "${postalCode}"`)
      confidence -= 0.5
    }
  }

  // Step 5 — normalize address casing (all-caps strings > 10 chars)
  const normCase = (s: string, field: string) => {
    if (s.length > 10 && s === s.toUpperCase() && /[A-Z]/.test(s)) {
      const nc = titleCaseAddress(s)
      if (nc !== s) addCorrection(field, s, nc, 'Converted all-caps to title case', 'minor')
      return nc
    }
    return s
  }
  addr1 = normCase(addr1, 'address_line1')
  city = normCase(city, 'city')

  // Step 6 — normalize street suffix
  if (addr1) {
    const { result, changed } = normalizeStreetSuffix(addr1)
    if (changed) {
      addCorrection('address_line1', addr1, result, 'Normalized street suffix to USPS Pub 28 standard', 'minor')
      addr1 = result
    }
  }

  // Step 7 — generate dedupe_hash
  let dedupeHash: string | null = null
  if (addr1 && city && normalizedState && normalizedPostal && issues.length === 0) {
    const postal5 = normalizedPostal.slice(0, 5)
    const hashInput = [
      addr1.toLowerCase().replace(/\s+/g, ' ').trim(),
      city.toLowerCase().trim(),
      normalizedState.toLowerCase(),
      postal5,
      country.toLowerCase(),
    ].join('|')
    dedupeHash = crypto.createHash('sha256').update(hashInput).digest('hex')
  }

  // Step 8 — score confidence (cap at [0,1])
  confidence = Math.min(1, Math.max(0, Math.round(confidence * 100) / 100))

  const status: ScrubStatus = issues.length > 0 ? 'needs_review' : corrections.length > 0 ? 'auto_corrected' : 'clean'

  const validatedAddress: ValidatedAddress | null =
    addr1 && city && normalizedState && normalizedPostal
      ? {
          address_line1: addr1,
          ...(addr2 ? { address_line2: addr2 } : {}),
          city,
          state: normalizedState,
          postal_code: normalizedPostal,
          country,
        }
      : null

  return { status, corrections, confidence, dedupe_hash: dedupeHash, validated_address: validatedAddress, issues }
}
