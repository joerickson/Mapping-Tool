// Phase 3.8 — working day counting (weekdays minus federal holidays).
//
// Crew count math divides building-days needed by working days in the
// cycle, so we need an accurate working-day count, not a 5/7 estimate
// that ignores holiday weeks.

export interface WorkingDaysInput {
  startDate: Date
  endDate: Date
  excludeWeekends?: boolean
  holidays?: Date[]
}

export function countWorkingDays(input: WorkingDaysInput): number {
  const exclWeekends = input.excludeWeekends ?? true
  const holidayKeys = new Set(
    (input.holidays ?? []).map((d) => toDateKey(d))
  )
  let count = 0
  const cur = new Date(
    Date.UTC(
      input.startDate.getUTCFullYear(),
      input.startDate.getUTCMonth(),
      input.startDate.getUTCDate()
    )
  )
  const end = new Date(
    Date.UTC(
      input.endDate.getUTCFullYear(),
      input.endDate.getUTCMonth(),
      input.endDate.getUTCDate()
    )
  )
  while (cur <= end) {
    const dow = cur.getUTCDay()
    const isWeekend = dow === 0 || dow === 6
    const key = toDateKey(cur)
    if ((!exclWeekends || !isWeekend) && !holidayKeys.has(key)) count++
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return count
}

function toDateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate()
  ).padStart(2, '0')}`
}

// US federal holidays for the years a span overlaps. Hardcoded for
// Phase 3.8; later phases can make this user-configurable per account.
export function getDefaultHolidays(startDate: Date, endDate: Date): Date[] {
  const startYear = startDate.getUTCFullYear()
  const endYear = endDate.getUTCFullYear()
  const out: Date[] = []
  for (let y = startYear; y <= endYear; y++) {
    out.push(...holidaysForYear(y))
  }
  return out
}

function holidaysForYear(year: number): Date[] {
  return [
    utc(year, 1, 1), // New Year's Day
    nthWeekdayOfMonth(year, 1, 1, 3), // MLK Day — 3rd Monday Jan
    nthWeekdayOfMonth(year, 2, 1, 3), // Presidents Day — 3rd Monday Feb
    lastWeekdayOfMonth(year, 5, 1), // Memorial Day — last Monday May
    utc(year, 6, 19), // Juneteenth
    utc(year, 7, 4), // Independence Day
    nthWeekdayOfMonth(year, 9, 1, 1), // Labor Day — 1st Monday Sept
    nthWeekdayOfMonth(year, 10, 1, 2), // Columbus Day — 2nd Monday Oct
    utc(year, 11, 11), // Veterans Day
    nthWeekdayOfMonth(year, 11, 4, 4), // Thanksgiving — 4th Thursday Nov
    addDaysUtc(nthWeekdayOfMonth(year, 11, 4, 4), 1), // Day after Thanksgiving
    utc(year, 12, 24), // Christmas Eve
    utc(year, 12, 25), // Christmas Day
  ]
}

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number, // 0=Sun ... 6=Sat
  n: number
): Date {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const offset = (weekday - first.getUTCDay() + 7) % 7
  return new Date(Date.UTC(year, month - 1, 1 + offset + (n - 1) * 7))
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  // Walk back from the last day of the month.
  const last = new Date(Date.UTC(year, month, 0))
  const offset = (last.getUTCDay() - weekday + 7) % 7
  return new Date(Date.UTC(year, month - 1, last.getUTCDate() - offset))
}

function addDaysUtc(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n))
}
