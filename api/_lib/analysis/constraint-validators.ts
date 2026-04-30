// Validators for service-location constraint configs. Each constraint_type
// has its own expected `config` shape — this module is the single source of
// truth for those shapes and is called by every API endpoint that writes
// constraint rows (POST, PUT, bulk-apply, template apply).
//
// Hand-rolled rather than Zod: the shapes are simple, the type-set is small,
// and adding a runtime dep just for this isn't worth it.

export type ConstraintType =
  | 'day_of_week'
  | 'blackout_dates'
  | 'seasonal_window'
  | 'time_window'
  | 'access_requirement'
  | 'contact_requirement'

export type ConstraintEnforcement = 'hard' | 'soft'

export interface ConstraintInput {
  constraint_type: string
  enforcement: string
  config: unknown
  notes?: string | null
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
  // Normalized config — caller should persist this rather than the raw input
  // (e.g. dedups, sorts, lowercases). Only present when ok=true.
  normalized?: {
    constraint_type: ConstraintType
    enforcement: ConstraintEnforcement
    config: Record<string, unknown>
  }
}

const CONSTRAINT_TYPES: ConstraintType[] = [
  'day_of_week',
  'blackout_dates',
  'seasonal_window',
  'time_window',
  'access_requirement',
  'contact_requirement',
]

// Group labels surfaced in the Add Constraint dialog. Kept here so UI and
// API agree on what each type is.
export const CONSTRAINT_GROUPS: Record<'schedule' | 'access' | 'operations', ConstraintType[]> = {
  schedule: ['day_of_week', 'blackout_dates', 'seasonal_window', 'time_window'],
  access: ['access_requirement'],
  operations: ['contact_requirement'],
}

export const CONSTRAINT_LABELS: Record<ConstraintType, string> = {
  day_of_week: 'Day-of-week restriction',
  blackout_dates: 'Blackout dates',
  seasonal_window: 'Seasonal window',
  time_window: 'Time-of-day window',
  access_requirement: 'Access requirement',
  contact_requirement: 'Contact requirement',
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const HHMM_RE = /^\d{2}:\d{2}$/

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function validateConstraint(input: ConstraintInput): ValidationResult {
  const errors: string[] = []

  if (!CONSTRAINT_TYPES.includes(input.constraint_type as ConstraintType)) {
    errors.push(
      `constraint_type must be one of: ${CONSTRAINT_TYPES.join(', ')} (got: ${input.constraint_type})`
    )
    return { ok: false, errors }
  }
  const type = input.constraint_type as ConstraintType

  if (input.enforcement !== 'hard' && input.enforcement !== 'soft') {
    errors.push(`enforcement must be 'hard' or 'soft' (got: ${input.enforcement})`)
    return { ok: false, errors }
  }
  const enforcement = input.enforcement as ConstraintEnforcement

  if (!isPlainObject(input.config)) {
    errors.push('config must be an object')
    return { ok: false, errors }
  }

  const normalizedConfig = validateConfigByType(type, input.config, errors)
  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    errors: [],
    normalized: { constraint_type: type, enforcement, config: normalizedConfig },
  }
}

function validateConfigByType(
  type: ConstraintType,
  config: Record<string, unknown>,
  errors: string[]
): Record<string, unknown> {
  switch (type) {
    case 'day_of_week':
      return validateDayOfWeek(config, errors)
    case 'blackout_dates':
      return validateBlackoutDates(config, errors)
    case 'seasonal_window':
      return validateSeasonalWindow(config, errors)
    case 'time_window':
      return validateTimeWindow(config, errors)
    case 'access_requirement':
      return validateAccessRequirement(config, errors)
    case 'contact_requirement':
      return validateContactRequirement(config, errors)
  }
}

// { allowed_days: number[] } — 0=Sunday … 6=Saturday. Must be non-empty,
// values must be ints 0-6, dedup + sort on normalize.
function validateDayOfWeek(c: Record<string, unknown>, errors: string[]) {
  const days = c.allowed_days
  if (!Array.isArray(days) || days.length === 0) {
    errors.push('day_of_week.allowed_days must be a non-empty array')
    return c
  }
  const seen = new Set<number>()
  for (const d of days) {
    if (typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 6) {
      errors.push(`day_of_week.allowed_days[*] must be integers 0–6 (got: ${JSON.stringify(d)})`)
      return c
    }
    seen.add(d)
  }
  return { allowed_days: Array.from(seen).sort((a, b) => a - b) }
}

// { dates: string[] } — ISO YYYY-MM-DD. Must be non-empty, valid dates.
function validateBlackoutDates(c: Record<string, unknown>, errors: string[]) {
  const dates = c.dates
  if (!Array.isArray(dates) || dates.length === 0) {
    errors.push('blackout_dates.dates must be a non-empty array')
    return c
  }
  const seen = new Set<string>()
  for (const d of dates) {
    if (typeof d !== 'string' || !ISO_DATE_RE.test(d) || Number.isNaN(Date.parse(d))) {
      errors.push(`blackout_dates.dates[*] must be ISO YYYY-MM-DD (got: ${JSON.stringify(d)})`)
      return c
    }
    seen.add(d)
  }
  return { dates: Array.from(seen).sort() }
}

// { start_month: 1-12, end_month: 1-12 } — inclusive on both ends. If start
// > end the window wraps the year (e.g. 11→3 = Nov–Mar).
function validateSeasonalWindow(c: Record<string, unknown>, errors: string[]) {
  const sm = c.start_month
  const em = c.end_month
  for (const [k, v] of [
    ['start_month', sm],
    ['end_month', em],
  ] as const) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 12) {
      errors.push(`seasonal_window.${k} must be integer 1–12 (got: ${JSON.stringify(v)})`)
      return c
    }
  }
  return { start_month: sm as number, end_month: em as number }
}

// { earliest_start: 'HH:MM', latest_end: 'HH:MM' } — service must run
// inside [earliest_start, latest_end). If end <= start the window wraps
// midnight (e.g. 22:00→06:00 = overnight).
function validateTimeWindow(c: Record<string, unknown>, errors: string[]) {
  const start = c.earliest_start
  const end = c.latest_end
  for (const [k, v] of [
    ['earliest_start', start],
    ['latest_end', end],
  ] as const) {
    if (typeof v !== 'string' || !HHMM_RE.test(v)) {
      errors.push(`time_window.${k} must be 'HH:MM' (got: ${JSON.stringify(v)})`)
      return c
    }
    const [h, m] = (v as string).split(':').map(Number)
    if (h < 0 || h > 23 || m < 0 || m > 59) {
      errors.push(`time_window.${k} hours/minutes out of range (got: ${v})`)
      return c
    }
  }
  return { earliest_start: start as string, latest_end: end as string }
}

// { kind: 'badge' | 'escort' | 'key' | 'code' | 'other', details?: string }
const ACCESS_KINDS = ['badge', 'escort', 'key', 'code', 'other'] as const
function validateAccessRequirement(c: Record<string, unknown>, errors: string[]) {
  const kind = c.kind
  if (typeof kind !== 'string' || !(ACCESS_KINDS as readonly string[]).includes(kind)) {
    errors.push(
      `access_requirement.kind must be one of: ${ACCESS_KINDS.join(', ')} (got: ${JSON.stringify(kind)})`
    )
    return c
  }
  const details = c.details
  if (details !== undefined && details !== null && typeof details !== 'string') {
    errors.push('access_requirement.details must be a string when present')
    return c
  }
  const out: Record<string, unknown> = { kind }
  if (typeof details === 'string' && details.trim().length > 0) out.details = details.trim()
  return out
}

// { contact_name?, contact_phone?, advance_notice_hours?: number,
//   instructions?: string } — at least one field must be set so the
// constraint actually says something.
function validateContactRequirement(c: Record<string, unknown>, errors: string[]) {
  const out: Record<string, unknown> = {}
  if (c.contact_name !== undefined && c.contact_name !== null) {
    if (typeof c.contact_name !== 'string') {
      errors.push('contact_requirement.contact_name must be a string')
      return c
    }
    if (c.contact_name.trim().length > 0) out.contact_name = c.contact_name.trim()
  }
  if (c.contact_phone !== undefined && c.contact_phone !== null) {
    if (typeof c.contact_phone !== 'string') {
      errors.push('contact_requirement.contact_phone must be a string')
      return c
    }
    if (c.contact_phone.trim().length > 0) out.contact_phone = c.contact_phone.trim()
  }
  if (c.advance_notice_hours !== undefined && c.advance_notice_hours !== null) {
    const h = c.advance_notice_hours
    if (typeof h !== 'number' || !Number.isFinite(h) || h < 0) {
      errors.push('contact_requirement.advance_notice_hours must be a non-negative number')
      return c
    }
    out.advance_notice_hours = h
  }
  if (c.instructions !== undefined && c.instructions !== null) {
    if (typeof c.instructions !== 'string') {
      errors.push('contact_requirement.instructions must be a string')
      return c
    }
    if (c.instructions.trim().length > 0) out.instructions = c.instructions.trim()
  }
  if (Object.keys(out).length === 0) {
    errors.push('contact_requirement requires at least one of: contact_name, contact_phone, advance_notice_hours, instructions')
  }
  return out
}
