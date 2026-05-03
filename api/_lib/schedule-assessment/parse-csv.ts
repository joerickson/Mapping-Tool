// Parse a schedule-assessment CSV into normalized rows. Required
// columns (case-insensitive, trimmed): address, scheduled_date.
// Optional: crew_name. Date parses ISO-ish (YYYY-MM-DD or
// MM/DD/YYYY). Bad rows are returned as 'errors' so the wizard can
// surface them.
import Papa from 'papaparse'

export interface ParsedRow {
  raw_address: string
  raw_scheduled_date: string | null // ISO YYYY-MM-DD
  raw_crew_name: string | null
}

export interface ParseError {
  line: number
  reason: string
}

export interface ParseResult {
  rows: ParsedRow[]
  errors: ParseError[]
}

// Headers that always mean "address."
const ADDRESS_ALIASES = new Set([
  'address',
  'property',
  'property_address',
  'location',
  'site',
])
// Headers that always mean "crew."
const CREW_ALIASES = new Set(['crew_name', 'crew', 'team'])

// Single-visit date headers.
const SINGLE_DATE_ALIASES = new Set([
  'scheduled_date',
  'date',
  'visit_date',
  'service_date',
])

// Multi-visit date column patterns. Each property row may have N
// separate date columns (first_visit_date, second_visit_date,
// visit_1_date, visit_2, etc.). When detected, the parser emits
// ONE row per non-empty date column instead of one row per CSV
// line. This is how 2-visits-per-cycle schedules show up.
const ORDINAL_WORDS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
}

interface HeaderInfo {
  semantic: 'address' | 'date' | 'crew' | null
  visit_index: number | null // 1-based; null for single-date headers
  raw: string
}

function normalizeHeader(h: string): HeaderInfo {
  const raw = h
  const k = h.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
  if (ADDRESS_ALIASES.has(k)) return { semantic: 'address', visit_index: null, raw }
  if (CREW_ALIASES.has(k)) return { semantic: 'crew', visit_index: null, raw }
  if (SINGLE_DATE_ALIASES.has(k)) return { semantic: 'date', visit_index: null, raw }
  // Multi-visit pattern: "first_visit_date", "visit_1_date", "1st_visit",
  // "visit2", "second_date", etc.
  // Try ordinal-word + date: "first_visit_date" → visit 1
  for (const [word, idx] of Object.entries(ORDINAL_WORDS)) {
    if (k.startsWith(word) && (k.includes('visit') || k.includes('date'))) {
      return { semantic: 'date', visit_index: idx, raw }
    }
  }
  // Try numeric pattern: "visit_1_date", "visit_2", "1st_visit_date",
  // "date_1", "second_visit_date" already covered above.
  const num = k.match(/(?:^|_)(\d+)(?:st|nd|rd|th)?(?:_|$)/)?.[1]
  if (num && (k.includes('visit') || k.includes('date'))) {
    return { semantic: 'date', visit_index: parseInt(num, 10), raw }
  }
  return { semantic: null, visit_index: null, raw }
}

function parseDate(s: string): string | null {
  const trimmed = s.trim()
  if (!trimmed) return null
  // ISO YYYY-MM-DD.
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(trimmed)
  if (iso) {
    const y = iso[1]
    const m = iso[2].padStart(2, '0')
    const d = iso[3].padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  // M/D/YYYY or M/D/YY.
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(trimmed)
  if (us) {
    let y = us[3]
    if (y.length === 2) y = `20${y}` // 2-digit assume current millennium
    const m = us[1].padStart(2, '0')
    const d = us[2].padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  // Try Date constructor as last resort.
  const dt = new Date(trimmed)
  if (!isNaN(dt.getTime())) {
    return dt.toISOString().slice(0, 10)
  }
  return null
}

export function parseScheduleCsv(csv: string): ParseResult {
  const result = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: 'greedy',
  })
  const rows: ParsedRow[] = []
  const errors: ParseError[] = []
  if (result.errors.length > 0) {
    for (const e of result.errors) {
      errors.push({ line: (e.row ?? 0) + 2, reason: e.message })
    }
  }
  // Classify every column.
  const fields = result.meta.fields ?? []
  const headers = fields.map((f) => normalizeHeader(f))

  // Single-date columns and per-visit-index date columns.
  const addressCols = headers.filter((h) => h.semantic === 'address').map((h) => h.raw)
  const crewCols = headers.filter((h) => h.semantic === 'crew').map((h) => h.raw)
  const dateCols = headers.filter((h) => h.semantic === 'date')
  // Sort numbered visit dates by visit_index so visit 1 comes before
  // visit 2 in the output.
  const orderedDateCols = [...dateCols].sort((a, b) => {
    const ai = a.visit_index ?? 0
    const bi = b.visit_index ?? 0
    if (ai !== bi) return ai - bi
    return 0
  })

  if (addressCols.length === 0 || orderedDateCols.length === 0) {
    return {
      rows: [],
      errors: [
        {
          line: 1,
          reason:
            'CSV must include an "address" column and at least one "scheduled_date" / "first_visit_date" / "second_visit_date" column. ' +
            `Got: ${fields.join(', ')}`,
        },
      ],
    }
  }

  for (let i = 0; i < (result.data ?? []).length; i++) {
    const row = result.data[i] as Record<string, string>
    const address = addressCols.map((c) => (row[c] ?? '').toString().trim()).find(Boolean) ?? ''
    const crew = crewCols.map((c) => (row[c] ?? '').toString().trim()).find(Boolean) ?? ''
    if (!address) {
      errors.push({ line: i + 2, reason: 'missing address' })
      continue
    }
    // Emit one ParsedRow per non-empty date column.
    let emittedAny = false
    for (const dateCol of orderedDateCols) {
      const raw = (row[dateCol.raw] ?? '').toString().trim()
      if (!raw) continue
      const parsed = parseDate(raw)
      if (!parsed) {
        errors.push({
          line: i + 2,
          reason: `unparseable date in "${dateCol.raw}": "${raw}"`,
        })
        continue
      }
      rows.push({
        raw_address: address,
        raw_scheduled_date: parsed,
        raw_crew_name: crew || null,
      })
      emittedAny = true
    }
    if (!emittedAny) {
      errors.push({ line: i + 2, reason: 'no scheduled date columns populated' })
    }
  }
  return { rows, errors }
}
