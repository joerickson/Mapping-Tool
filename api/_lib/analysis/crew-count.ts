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
  type ClassifyContext,
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
  // Phase 4 follow-up — passed to the classifier so we use crew-clock
  // hours instead of raw labor hours. Default: 3-person crew, 10-hr
  // day. Without this, a 24-hour cleaning task gets classified as
  // multi-day (3 crew-days) when in reality a 3-person crew finishes
  // in 8 clock hours (1 crew-day).
  crew_size?: number
  hours_per_day?: number
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
  // Phase 4 follow-up — surface the visits eating the most crew-days
  // so the user can audit "why does it say 6 crews" — multi-day
  // buildings + high visits_per_year are the usual suspects.
  audit: {
    top_consumers: Array<{
      service_location_id: string
      hours_per_visit: number
      size_class: BuildingSizeClass
      crew_days_per_visit_conservative: number
    }>
    multi_day_visits: number
    multi_day_crew_days: number
    visits_per_year_distribution: Record<number, number>
  }
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
  let multiDayVisits = 0
  let multiDayCrewDays = 0
  // Group visits by service_location_id to count visits/year.
  const visitsBySl = new Map<string, number>()
  // Per-visit contribution so we can surface the worst offenders.
  type Contributor = {
    service_location_id: string
    hours_per_visit: number
    size_class: BuildingSizeClass
    crew_days_per_visit_conservative: number
  }
  const contributors: Contributor[] = []

  const ctx: ClassifyContext = {
    crew_size: input.crew_size ?? 3,
    hours_per_day: input.hours_per_day ?? 10,
  }
  for (const visit of input.routed_visits) {
    const sizeClass = effectiveSizeClass(visit, ctx)
    sizeBreakdown[sizeClass]++
    const dConservative = crewDaysPerVisit(
      sizeClass,
      visit.hours_per_visit,
      'conservative',
      ctx
    )
    conservativeCrewDays += dConservative
    optimisticCrewDays += crewDaysPerVisit(
      sizeClass,
      visit.hours_per_visit,
      'optimistic',
      ctx
    )
    if (sizeClass === 'multi_day') {
      multiDayVisits += 1
      multiDayCrewDays += dConservative
    }
    visitsBySl.set(
      visit.service_location_id,
      (visitsBySl.get(visit.service_location_id) ?? 0) + 1
    )
    contributors.push({
      service_location_id: visit.service_location_id,
      hours_per_visit: visit.hours_per_visit,
      size_class: sizeClass,
      crew_days_per_visit_conservative: dConservative,
    })
  }

  // Distribution of visits/year across service_locations — high
  // visits_per_year (e.g. 6 instead of the default 2) is the other
  // usual suspect for an inflated crew_count.
  const visitsDistribution: Record<number, number> = {}
  for (const count of visitsBySl.values()) {
    visitsDistribution[count] = (visitsDistribution[count] ?? 0) + 1
  }

  // Top 8 unique service_locations sorted by crew-days they
  // consumed (sum across all their visits in the cycle).
  const totalsBySl = new Map<string, Contributor & { totalDays: number }>()
  for (const c of contributors) {
    const existing = totalsBySl.get(c.service_location_id)
    if (existing) {
      existing.totalDays += c.crew_days_per_visit_conservative
    } else {
      totalsBySl.set(c.service_location_id, {
        ...c,
        totalDays: c.crew_days_per_visit_conservative,
      })
    }
  }
  const topConsumers = Array.from(totalsBySl.values())
    .sort((a, b) => b.totalDays - a.totalDays)
    .slice(0, 8)
    .map((c) => ({
      service_location_id: c.service_location_id,
      hours_per_visit: Math.round(c.hours_per_visit * 10) / 10,
      size_class: c.size_class,
      crew_days_per_visit_conservative:
        Math.round(c.crew_days_per_visit_conservative * 10) / 10,
    }))

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
    audit: {
      top_consumers: topConsumers,
      multi_day_visits: multiDayVisits,
      multi_day_crew_days: Math.round(multiDayCrewDays * 10) / 10,
      visits_per_year_distribution: visitsDistribution,
    },
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export { classifyBuildingSize }
