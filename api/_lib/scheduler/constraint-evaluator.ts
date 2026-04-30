// Phase 4c — evaluate one Phase 4a service_location constraint against a
// proposed schedule context. Pure function, no I/O.
//
// The 4c spec used some constraint type names that don't match the actual
// 4a implementation (e.g. "forbidden_days_of_week", "preferred_time_window").
// This module bridges the two — it operates on the actual stored shapes
// (day_of_week, blackout_dates, seasonal_window, time_window,
// access_requirement, contact_requirement) and emits a uniform
// {satisfied, severity, description} result the routing engine can score.

export interface StoredConstraint {
  id: string
  service_location_id: string
  constraint_type:
    | 'day_of_week'
    | 'blackout_dates'
    | 'seasonal_window'
    | 'time_window'
    | 'access_requirement'
    | 'contact_requirement'
    | string
  enforcement: 'hard' | 'soft'
  config: Record<string, unknown>
  notes?: string | null
}

export interface EvaluationContext {
  scheduled_date: string // 'YYYY-MM-DD'
  arrival_time: string // 'HH:MM'
  work_start_time: string // 'HH:MM' (after buffer)
  work_end_time: string // 'HH:MM'
  crew_size: number
  // Whether the previous stop on the route was at this same property —
  // used by the (currently informational) no_back_to_back check.
  previous_stop_was_same_property?: boolean
}

export interface ConstraintEvaluation {
  constraint_id: string
  constraint_type: string
  satisfied: boolean
  severity: 'hard' | 'soft'
  description: string
  // 'enforceable' = fully evaluated automatically. 'informational' = the
  // routing engine can't fully evaluate (e.g. minimum_notice_hours needs
  // dispatch context); we still surface it on the stop so the user sees it.
  category: 'enforceable' | 'informational'
}

export function evaluateConstraint(
  c: StoredConstraint,
  ctx: EvaluationContext
): ConstraintEvaluation {
  const base = {
    constraint_id: c.id,
    constraint_type: c.constraint_type,
    severity: c.enforcement,
  }

  switch (c.constraint_type) {
    case 'day_of_week':
      return evalDayOfWeek(c, ctx, base)
    case 'blackout_dates':
      return evalBlackoutDates(c, ctx, base)
    case 'seasonal_window':
      return evalSeasonalWindow(c, ctx, base)
    case 'time_window':
      return evalTimeWindow(c, ctx, base)
    case 'access_requirement':
      return {
        ...base,
        satisfied: true, // can't enforce automatically; surfaces as informational
        category: 'informational',
        description: accessDescription(c.config),
      }
    case 'contact_requirement':
      return {
        ...base,
        satisfied: true,
        category: 'informational',
        description: contactDescription(c.config),
      }
    default:
      return {
        ...base,
        satisfied: true,
        category: 'informational',
        description: `Unknown constraint type "${c.constraint_type}"`,
      }
  }
}

function evalDayOfWeek(
  c: StoredConstraint,
  ctx: EvaluationContext,
  base: Pick<ConstraintEvaluation, 'constraint_id' | 'constraint_type' | 'severity'>
): ConstraintEvaluation {
  const allowed = (c.config as { allowed_days?: number[] }).allowed_days ?? []
  // Date-fns alternative: parse YYYY-MM-DD as UTC, getUTCDay()
  const [y, m, d] = ctx.scheduled_date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const dow = dt.getUTCDay() // 0 = Sun
  const ok = allowed.includes(dow)
  return {
    ...base,
    satisfied: ok,
    category: 'enforceable',
    description: ok
      ? `Day-of-week (${DAY_LABELS[dow]}) is allowed.`
      : `Service not allowed on ${DAY_LABELS[dow]}; allowed days: ${allowed.map((n) => DAY_LABELS[n]).join(', ')}.`,
  }
}

function evalBlackoutDates(
  c: StoredConstraint,
  ctx: EvaluationContext,
  base: Pick<ConstraintEvaluation, 'constraint_id' | 'constraint_type' | 'severity'>
): ConstraintEvaluation {
  const dates = (c.config as { dates?: string[] }).dates ?? []
  const blackedOut = dates.includes(ctx.scheduled_date)
  return {
    ...base,
    satisfied: !blackedOut,
    category: 'enforceable',
    description: blackedOut
      ? `${ctx.scheduled_date} is a blackout date.`
      : `${ctx.scheduled_date} is not a blackout date.`,
  }
}

function evalSeasonalWindow(
  c: StoredConstraint,
  ctx: EvaluationContext,
  base: Pick<ConstraintEvaluation, 'constraint_id' | 'constraint_type' | 'severity'>
): ConstraintEvaluation {
  const cfg = c.config as { start_month?: number; end_month?: number }
  const sm = cfg.start_month ?? 1
  const em = cfg.end_month ?? 12
  const month = Number(ctx.scheduled_date.slice(5, 7))
  // Window can wrap (e.g. 11→3 = Nov, Dec, Jan, Feb, Mar)
  const inWindow = sm <= em ? month >= sm && month <= em : month >= sm || month <= em
  return {
    ...base,
    satisfied: inWindow,
    category: 'enforceable',
    description: inWindow
      ? `Inside seasonal window (${MONTH_LABELS[sm - 1]}–${MONTH_LABELS[em - 1]}).`
      : `Outside seasonal window (${MONTH_LABELS[sm - 1]}–${MONTH_LABELS[em - 1]}); scheduled month is ${MONTH_LABELS[month - 1]}.`,
  }
}

function evalTimeWindow(
  c: StoredConstraint,
  ctx: EvaluationContext,
  base: Pick<ConstraintEvaluation, 'constraint_id' | 'constraint_type' | 'severity'>
): ConstraintEvaluation {
  const cfg = c.config as { earliest_start?: string; latest_end?: string }
  const earliest = cfg.earliest_start ?? '00:00'
  const latest = cfg.latest_end ?? '23:59'
  const ws = toMinutes(ctx.work_start_time)
  const we = toMinutes(ctx.work_end_time)
  const e = toMinutes(earliest)
  const l = toMinutes(latest)
  // Window can wrap midnight (e.g. 22:00→06:00 overnight). When wrapped,
  // a satisfied work block lies entirely inside [earliest, 24:00] OR
  // entirely inside [00:00, latest].
  let satisfied: boolean
  if (e <= l) {
    satisfied = ws >= e && we <= l
  } else {
    satisfied = (ws >= e && we <= 24 * 60) || (ws >= 0 && we <= l)
  }
  return {
    ...base,
    satisfied,
    category: 'enforceable',
    description: satisfied
      ? `Work window ${ctx.work_start_time}–${ctx.work_end_time} fits inside ${earliest}–${latest}.`
      : `Work window ${ctx.work_start_time}–${ctx.work_end_time} falls outside ${earliest}–${latest}.`,
  }
}

function accessDescription(cfg: Record<string, unknown>): string {
  const kind = (cfg.kind as string | undefined) ?? 'access'
  const details = (cfg.details as string | undefined) ?? ''
  return `Access requirement: ${kind}${details ? ` — ${details}` : ''} (informational)`
}

function contactDescription(cfg: Record<string, unknown>): string {
  const parts: string[] = []
  if (cfg.contact_name) parts.push(`Contact: ${cfg.contact_name}`)
  if (cfg.contact_phone) parts.push(`${cfg.contact_phone}`)
  if (cfg.advance_notice_hours != null) parts.push(`${cfg.advance_notice_hours}h notice`)
  if (cfg.instructions) parts.push(`"${cfg.instructions}"`)
  return `Contact requirement: ${parts.join(' · ')} (informational)`
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m ?? 0)
}

export function fromMinutes(min: number): string {
  const wrapped = ((min % (24 * 60)) + 24 * 60) % (24 * 60)
  const h = Math.floor(wrapped / 60)
  const m = wrapped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
