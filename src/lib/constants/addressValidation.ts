export interface ValidationResult {
  valid: boolean
  corrected_value?: string
  error?: string
}

// ---------------------------------------------------------------------------
// Country normalization
// ---------------------------------------------------------------------------

const COUNTRY_ALIASES: Record<string, 'US' | 'CA' | 'MX'> = {
  us: 'US', usa: 'US', 'united states': 'US', 'united states of america': 'US', america: 'US',
  ca: 'CA', can: 'CA', canada: 'CA',
  mx: 'MX', mex: 'MX', mexico: 'MX', 'méxico': 'MX',
}

export function normalizeCountry(raw: string): 'US' | 'CA' | 'MX' | null {
  return COUNTRY_ALIASES[raw.toLowerCase().trim()] ?? null
}

// ---------------------------------------------------------------------------
// US states
// ---------------------------------------------------------------------------

export const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'GU', 'VI', 'AS', 'MP',
])

export const US_STATE_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR',
  california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
  illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS',
  kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
  'puerto rico': 'PR', guam: 'GU', 'virgin islands': 'VI',
  'american samoa': 'AS', 'northern mariana islands': 'MP',
}

// ---------------------------------------------------------------------------
// Canadian provinces / territories
// ---------------------------------------------------------------------------

export const CA_PROVINCE_CODES = new Set([
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
])

export const CA_PROVINCE_NAMES: Record<string, string> = {
  alberta: 'AB',
  'british columbia': 'BC',
  manitoba: 'MB',
  'new brunswick': 'NB',
  newfoundland: 'NL',
  'newfoundland and labrador': 'NL',
  'nova scotia': 'NS',
  'northwest territories': 'NT',
  nunavut: 'NU',
  ontario: 'ON',
  'prince edward island': 'PE',
  quebec: 'QC',
  'québec': 'QC',
  saskatchewan: 'SK',
  yukon: 'YT',
}

// ---------------------------------------------------------------------------
// Mexican states (INEGI 3-letter codes + common 2-letter codes both accepted)
// ---------------------------------------------------------------------------

export const MX_STATE_CODES = new Set([
  // 3-letter INEGI codes
  'AGS', 'BCN', 'BCS', 'CAM', 'CMX', 'CHS', 'CHH', 'COA', 'COL',
  'DGO', 'GTO', 'GRO', 'HGO', 'JAL', 'MEX', 'MCH', 'MOR', 'NAY',
  'NLE', 'OAX', 'PUE', 'QRO', 'ROO', 'SLP', 'SIN', 'SON', 'TAB',
  'TAM', 'TLA', 'VER', 'YUC', 'ZAC',
  // Common 2-letter abbreviations also accepted
  'AG', 'BC', 'BS', 'CM', 'DF', 'CS', 'CH', 'CO', 'CL', 'DG',
  'GT', 'GR', 'HG', 'JA', 'EM', 'MI', 'MO', 'NA', 'NL', 'OA',
  'PU', 'QT', 'QR', 'SL', 'SI', 'SO', 'TB', 'TM', 'TL', 'VE',
  'YU', 'ZA', 'CDMX',
])

export const MX_STATE_NAMES: Record<string, string> = {
  aguascalientes: 'AGS',
  'baja california': 'BCN',
  'baja california norte': 'BCN',
  'baja california sur': 'BCS',
  campeche: 'CAM',
  'ciudad de mexico': 'CMX',
  'ciudad de méxico': 'CMX',
  cdmx: 'CMX',
  'distrito federal': 'CMX',
  chiapas: 'CHS',
  chihuahua: 'CHH',
  coahuila: 'COA',
  'coahuila de zaragoza': 'COA',
  colima: 'COL',
  durango: 'DGO',
  guanajuato: 'GTO',
  guerrero: 'GRO',
  hidalgo: 'HGO',
  jalisco: 'JAL',
  'estado de mexico': 'MEX',
  'estado de méxico': 'MEX',
  'mexico state': 'MEX',
  michoacan: 'MCH',
  'michoacán': 'MCH',
  'michoacán de ocampo': 'MCH',
  morelos: 'MOR',
  nayarit: 'NAY',
  'nuevo leon': 'NLE',
  'nuevo león': 'NLE',
  oaxaca: 'OAX',
  puebla: 'PUE',
  queretaro: 'QRO',
  'querétaro': 'QRO',
  'quintana roo': 'ROO',
  'san luis potosi': 'SLP',
  'san luis potosí': 'SLP',
  sinaloa: 'SIN',
  sonora: 'SON',
  tabasco: 'TAB',
  tamaulipas: 'TAM',
  tlaxcala: 'TLA',
  veracruz: 'VER',
  'veracruz de ignacio de la llave': 'VER',
  yucatan: 'YUC',
  'yucatán': 'YUC',
  zacatecas: 'ZAC',
}

// ---------------------------------------------------------------------------
// Pure validator functions
// ---------------------------------------------------------------------------

export function validateState(state: string, country: 'US' | 'CA' | 'MX' | string): ValidationResult {
  if (!state) return { valid: false, error: 'State/province is required' }

  const up = state.toUpperCase().trim()
  const low = state.toLowerCase().trim()

  if (country === 'US') {
    if (US_STATE_CODES.has(up)) {
      return { valid: true, corrected_value: up !== state ? up : undefined }
    }
    const fromName = US_STATE_NAMES[low]
    if (fromName) {
      return { valid: true, corrected_value: fromName }
    }
    return { valid: false, error: `Unrecognized US state: "${state}"` }
  }

  if (country === 'CA') {
    if (CA_PROVINCE_CODES.has(up)) {
      return { valid: true, corrected_value: up !== state ? up : undefined }
    }
    const fromName = CA_PROVINCE_NAMES[low]
    if (fromName) {
      return { valid: true, corrected_value: fromName }
    }
    return { valid: false, error: `Unrecognized Canadian province: "${state}"` }
  }

  if (country === 'MX') {
    if (MX_STATE_CODES.has(up)) {
      return { valid: true, corrected_value: up !== state ? up : undefined }
    }
    const fromName = MX_STATE_NAMES[low]
    if (fromName) {
      return { valid: true, corrected_value: fromName }
    }
    return { valid: false, error: `Unrecognized Mexican state: "${state}"` }
  }

  // Unknown country — skip state validation
  return { valid: true }
}

export function validatePostalCode(postal: string, country: 'US' | 'CA' | 'MX' | string): ValidationResult {
  if (!postal) return { valid: false, error: 'Postal code is required' }

  if (country === 'US') {
    let pc = postal.replace(/\.0+$/, '')
    // Normalize 9-digit ZIP without hyphen
    if (/^\d{9}$/.test(pc)) pc = `${pc.slice(0, 5)}-${pc.slice(5)}`
    if (/^\d{5}(-\d{4})?$/.test(pc)) {
      return { valid: true, corrected_value: pc !== postal ? pc : undefined }
    }
    return { valid: false, error: `Invalid US postal code: "${postal}"` }
  }

  if (country === 'CA') {
    let pc = postal.toUpperCase().replace(/\s/g, '')
    if (pc.length !== 6) {
      return { valid: false, error: `Invalid Canadian postal code: "${postal}"` }
    }
    // Auto-correct letter O → digit 0 in numeric positions (1, 3, 5)
    let oFixed = false
    for (const idx of [1, 3, 5]) {
      if (pc[idx] === 'O') {
        pc = pc.slice(0, idx) + '0' + pc.slice(idx + 1)
        oFixed = true
      }
    }
    const formatted = `${pc.slice(0, 3)} ${pc.slice(3)}`
    if (/^[A-Z]\d[A-Z] \d[A-Z]\d$/.test(formatted)) {
      const changed = formatted !== postal || oFixed
      return { valid: true, corrected_value: changed ? formatted : undefined }
    }
    return { valid: false, error: `Invalid Canadian postal code: "${postal}"` }
  }

  if (country === 'MX') {
    const pc = postal.replace(/\.0+$/, '')
    if (/^\d{5}$/.test(pc)) {
      return { valid: true, corrected_value: pc !== postal ? pc : undefined }
    }
    return { valid: false, error: `Invalid Mexican postal code: "${postal}"` }
  }

  // Unknown country — accept any non-empty value
  return { valid: true }
}
