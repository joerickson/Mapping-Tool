// Phase 3.8 — building-count crew math.
//
// Replaces the hours-based crew count (annual hours / FTE hours) with
// a building-day model: 1 building = 1 crew-day by default, with
// pairing-aware optimistic and no-pairing conservative variants.
import {
  classifyBuildingSize,
  crewDaysPerVisit,
  effectiveSizeClass,
  type BuildingSizeClass,
} from './building-size.js'
import { countWorkingDays, getDefaultHolidays } from './working-days.js'

export interface CrewCountInput {
  routed_visits: Array<{
    service_location_id: string
    hours_per_visit: number
    building_size_class_override?: BuildingSizeClass | null
  }>
  cycle_length_days: number
  cycle_start_date?: Date
  cycles_per_year: number
}

export interface CrewCountModeResult {
  total_crew_days_per_cycle: number
  working_days_per_cycle: number
  crews_needed: number
  rationale: string
}

export interface CrewCountResult {
  conservative: CrewCountModeResult
  optimistic: CrewCountModeResult
  size_class_breakdown: Record<BuildingSizeClass, number>
  total_visits_per_cycle: number
  cycles_per_year: number
}

export function computeCrewCount(input: CrewCountInput): CrewCountResult {
  let conservativeCrewDays = 0
  let optimisticCrewDays = 0
  const sizeBreakdown: Record<BuildingSizeClass, number> = {
    small: 0,
    standard: 0,
    large: 0,
    multi_day: 0,
  }

  for (const visit of input.routed_visits) {
    const sizeClass = effectiveSizeClass(visit)
    sizeBreakdown[sizeClass]++
    conservativeCrewDays += crewDaysPerVisit(
      sizeClass,
      visit.hours_per_visit,
      'conservative'
    )
    optimisticCrewDays += crewDaysPerVisit(
      sizeClass,
      visit.hours_per_visit,
      'optimistic'
    )
  }

  const start = input.cycle_start_date ?? new Date()
  const end = new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate() + input.cycle_length_days
    )
  )
  const workingDays = Math.max(
    1,
    countWorkingDays({
      startDate: start,
      endDate: end,
      excludeWeekends: true,
      holidays: getDefaultHolidays(start, end),
    })
  )

  const conservativeCrews = Math.max(
    1,
    Math.ceil(conservativeCrewDays / workingDays)
  )
  const optimisticCrews = Math.max(
    1,
    Math.ceil(optimisticCrewDays / workingDays)
  )

  return {
    conservative: {
      total_crew_days_per_cycle: round1(conservativeCrewDays),
      working_days_per_cycle: workingDays,
      crews_needed: conservativeCrews,
      rationale: `${round1(conservativeCrewDays)} building-days needed, ${workingDays} working days in cycle, no pairing assumed`,
    },
    optimistic: {
      total_crew_days_per_cycle: round1(optimisticCrewDays),
      working_days_per_cycle: workingDays,
      crews_needed: optimisticCrews,
      rationale: `${round1(optimisticCrewDays)} building-days needed (with small-property pairing), ${workingDays} working days in cycle`,
    },
    size_class_breakdown: sizeBreakdown,
    total_visits_per_cycle: input.routed_visits.length,
    cycles_per_year: input.cycles_per_year,
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export { classifyBuildingSize }
