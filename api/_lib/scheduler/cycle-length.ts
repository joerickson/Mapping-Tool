// Phase 4d — cycle length computation. Pure function.
//
// The "cycle" is the unit of work for a routing template. It's derived
// from the parent offering with the highest visit frequency in the set
// (e.g. 2x/year project clean → 6mo cycle; mix of 2x and 4x → 3mo).
//
// All other routed visits get layered into that cycle. Properties whose
// parent visit frequency is LESS than 1 visit/cycle (e.g. 1-year-interval
// property in a 6mo cycle) are scheduled in alternating cycles by the
// template builder; this util just reports visits_per_cycle = 0 for them.

export interface PropertyForCycle {
  service_location_id: string
  parent_offering_visit_interval_years: number
}

export interface CycleLengthResult {
  cycle_length_days: number
  cycle_length_label: string
  cycle_count_per_year: number
  visits_per_cycle_by_interval: Record<string, number>
}

const DAYS_PER_YEAR = 365

export function computeCycleLength(
  properties: PropertyForCycle[],
  customCycleLengthDays?: number
): CycleLengthResult {
  if (customCycleLengthDays && customCycleLengthDays > 0) {
    return finishResult(customCycleLengthDays, properties)
  }

  const intervals = Array.from(
    new Set(properties.map((p) => p.parent_offering_visit_interval_years).filter((n) => n > 0))
  )

  if (intervals.length === 0) {
    return {
      cycle_length_days: DAYS_PER_YEAR,
      cycle_length_label: '12 months (no routed visits)',
      cycle_count_per_year: 1,
      visits_per_cycle_by_interval: {},
    }
  }

  const minInterval = Math.min(...intervals)
  const cycleDays = Math.round(minInterval * DAYS_PER_YEAR)
  return finishResult(cycleDays, properties, intervals)
}

function finishResult(
  cycleDays: number,
  properties: PropertyForCycle[],
  intervals?: number[]
): CycleLengthResult {
  const ints = intervals ??
    Array.from(new Set(properties.map((p) => p.parent_offering_visit_interval_years).filter((n) => n > 0)))

  const visitsPerCycleByInterval: Record<string, number> = {}
  for (const i of ints) {
    const visitsPerCycle = Math.max(0, Math.round(cycleDays / (i * DAYS_PER_YEAR)))
    visitsPerCycleByInterval[String(i)] = visitsPerCycle
  }

  return {
    cycle_length_days: cycleDays,
    cycle_length_label: labelForDays(cycleDays),
    cycle_count_per_year: Math.round((DAYS_PER_YEAR / cycleDays) * 100) / 100,
    visits_per_cycle_by_interval: visitsPerCycleByInterval,
  }
}

function labelForDays(days: number): string {
  if (days >= 28 && days <= 32) return '1 month'
  if (days >= 58 && days <= 65) return '2 months'
  if (days >= 85 && days <= 95) return '3 months'
  if (days >= 175 && days <= 188) return '6 months'
  if (days >= 358 && days <= 372) return '12 months'
  if (days >= 30) return `${Math.round(days / 30)} months`
  return `${days} days`
}

// Helper for the template builder: given a property's interval and cycle
// length, how many times does it visit in cycle N (1-indexed)?
//
// Cases:
// - interval × DAYS_PER_YEAR <= cycle_length_days → visits every cycle
//   (e.g. 0.25-year in 91-day cycle = 1 visit/cycle)
// - interval × DAYS_PER_YEAR > cycle_length_days → visits in some cycles,
//   not others (e.g. 1-year interval in 91-day cycle = visit every 4th cycle)
export function visitsForPropertyInCycle(
  intervalYears: number,
  cycleLengthDays: number,
  cycleNumber: number // 1-indexed
): number {
  if (intervalYears <= 0) return 0
  const intervalDays = intervalYears * DAYS_PER_YEAR
  if (intervalDays <= cycleLengthDays) {
    return Math.max(1, Math.round(cycleLengthDays / intervalDays))
  }
  // Lower frequency than cycle: visit every Nth cycle.
  const cyclesPerVisit = Math.round(intervalDays / cycleLengthDays)
  return cycleNumber % cyclesPerVisit === 1 ? 1 : 0
}
