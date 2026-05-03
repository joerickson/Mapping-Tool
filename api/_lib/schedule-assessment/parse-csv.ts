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

const ALIASES: Record<string, 'address' | 'date' | 'crew'> = {
  address: 'address',
  property: 'address',
  property_address: 'address',
  location: 'address',
  site: 'address',
  scheduled_date: 'date',
  date: 'date',
  visit_date: 'date',
  service_date: 'date',
  crew_name: 'crew',
  crew: 'crew',
  team: 'crew',
}

function normalizeHeader(h: string): 'address' | 'date' | 'crew' | null {
  const k = h.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
  return ALIASES[k] ?? null
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
  // Build a column-name map (raw header → semantic).
  const fields = result.meta.fields ?? []
  const colMap = new Map<string, 'address' | 'date' | 'crew'>()
  for (const f of fields) {
    const sem = normalizeHeader(f)
    if (sem) colMap.set(f, sem)
  }
  // Require at least address + date columns.
  const hasAddress = Array.from(colMap.values()).includes('address')
  const hasDate = Array.from(colMap.values()).includes('date')
  if (!hasAddress || !hasDate) {
    return {
      rows: [],
      errors: [
        {
          line: 1,
          reason:
            'CSV must include an "address" column and a "scheduled_date" column. ' +
            `Got: ${fields.join(', ')}`,
        },
      ],
    }
  }
  for (let i = 0; i < (result.data ?? []).length; i++) {
    const row = result.data[i] as Record<string, string>
    let address = ''
    let dateStr = ''
    let crew = ''
    for (const [col, sem] of colMap) {
      const v = (row[col] ?? '').toString().trim()
      if (sem === 'address' && !address) address = v
      else if (sem === 'date' && !dateStr) dateStr = v
      else if (sem === 'crew' && !crew) crew = v
    }
    if (!address) {
      errors.push({ line: i + 2, reason: 'missing address' })
      continue
    }
    if (!dateStr) {
      errors.push({ line: i + 2, reason: 'missing scheduled_date' })
      continue
    }
    const parsed = parseDate(dateStr)
    if (!parsed) {
      errors.push({ line: i + 2, reason: `unparseable date: "${dateStr}"` })
      continue
    }
    rows.push({
      raw_address: address,
      raw_scheduled_date: parsed,
      raw_crew_name: crew || null,
    })
  }
  return { rows, errors }
}
