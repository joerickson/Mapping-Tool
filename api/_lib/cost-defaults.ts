// Phase 3.5 — Single source of truth for system-wide cost assumptions.
// Re-exports the defaults that operational-constraints.ts already merges with
// the saved row, plus a getCostAssumptions() helper that produces a fully-
// populated cost-assumptions object from a constraints row.
//
// Design intent: every module endpoint should read cost assumptions from
// here (or from the merged constraints object) instead of hardcoding values
// inline. The Cost Assumptions panel writes overrides to
// account_operational_constraints; this module reads them back out.
import {
  SYSTEM_DEFAULTS,
  type OperationalConstraints,
} from './analysis/operational-constraints.js'

// New Phase 3.5 defaults that aren't in SYSTEM_DEFAULTS yet — extend the
// type later if these prove load-bearing for module math.
export const PHASE35_DEFAULTS = {
  working_days_per_year: 250,
  visits_per_year_default: 2,
} as const

export interface LaborBurdenBreakdown {
  wages: boolean
  payroll_taxes: boolean
  workers_comp: boolean
  benefits: boolean
  training: boolean
}

export const DEFAULT_LABOR_BURDEN: LaborBurdenBreakdown = {
  wages: true,
  payroll_taxes: true,
  workers_comp: true,
  benefits: true,
  training: false,
}

// Full assumptions snapshot — merge of SYSTEM_DEFAULTS + PHASE35_DEFAULTS +
// any saved overrides on the account row.
export interface CostAssumptions {
  // Crew Economics
  crew_size: number
  hours_per_day: number
  working_days_per_year: number
  hourly_loaded_labor_cost: number
  labor_burden_breakdown: LaborBurdenBreakdown

  // Productivity
  project_clean_base_hours: number
  project_clean_hours_per_sqft: number
  upholstery_solo_hours: number
  upholstery_combo_hours_pct: number
  recurring_productivity_sqft_per_hour: number
  visits_per_year_default: number

  // Vehicle & Fuel
  fuel_cost_per_mile: number
  vehicles_per_crew: number
  vehicle_lease_annual_per_crew: number
  drive_speed_mph: number
  max_one_way_drive_minutes: number

  // Surge
  surge_weeks_per_year: number
  surge_crew_count: number
  surge_premium_multiplier: number

  // Branch & Operational Costs
  branch_overhead_annual: number
  hotels_annual: number
  supplies_pct_of_labor: number
  insurance_annual: number
  corporate_overhead_pct: number
  target_gross_margin_pct: number
}

export function getCostAssumptions(
  constraints: OperationalConstraints & {
    working_days_per_year?: number | null
    visits_per_year_default?: number | null
    labor_burden_breakdown?: LaborBurdenBreakdown | null
  }
): CostAssumptions {
  return {
    crew_size: constraints.crew_size,
    hours_per_day: constraints.hours_per_day,
    working_days_per_year:
      constraints.working_days_per_year ?? PHASE35_DEFAULTS.working_days_per_year,
    hourly_loaded_labor_cost: constraints.hourly_loaded_labor_cost,
    labor_burden_breakdown:
      constraints.labor_burden_breakdown ?? DEFAULT_LABOR_BURDEN,

    project_clean_base_hours: constraints.project_clean_base_hours,
    project_clean_hours_per_sqft: constraints.project_clean_hours_per_sqft,
    upholstery_solo_hours: constraints.upholstery_solo_hours,
    upholstery_combo_hours_pct: constraints.upholstery_combo_hours_pct,
    recurring_productivity_sqft_per_hour: constraints.recurring_productivity_sqft_per_hour,
    visits_per_year_default:
      constraints.visits_per_year_default ?? PHASE35_DEFAULTS.visits_per_year_default,

    fuel_cost_per_mile: constraints.fuel_cost_per_mile,
    vehicles_per_crew: constraints.vehicles_per_crew,
    vehicle_lease_annual_per_crew: constraints.vehicle_lease_annual_per_crew,
    drive_speed_mph: constraints.drive_speed_mph,
    max_one_way_drive_minutes: constraints.max_one_way_drive_minutes,

    surge_weeks_per_year: constraints.surge_weeks_per_year,
    surge_crew_count: constraints.surge_crew_count,
    surge_premium_multiplier: constraints.surge_premium_multiplier,

    branch_overhead_annual: constraints.branch_overhead_annual,
    hotels_annual: constraints.hotels_annual,
    supplies_pct_of_labor: constraints.supplies_pct_of_labor,
    insurance_annual: constraints.insurance_annual,
    corporate_overhead_pct: constraints.corporate_overhead_pct,
    target_gross_margin_pct: constraints.target_gross_margin_pct,
  }
}

export const ALL_DEFAULTS: CostAssumptions = {
  crew_size: SYSTEM_DEFAULTS.crew_size,
  hours_per_day: SYSTEM_DEFAULTS.hours_per_day,
  working_days_per_year: PHASE35_DEFAULTS.working_days_per_year,
  hourly_loaded_labor_cost: SYSTEM_DEFAULTS.hourly_loaded_labor_cost,
  labor_burden_breakdown: DEFAULT_LABOR_BURDEN,

  project_clean_base_hours: SYSTEM_DEFAULTS.project_clean_base_hours,
  project_clean_hours_per_sqft: SYSTEM_DEFAULTS.project_clean_hours_per_sqft,
  upholstery_solo_hours: SYSTEM_DEFAULTS.upholstery_solo_hours,
  upholstery_combo_hours_pct: SYSTEM_DEFAULTS.upholstery_combo_hours_pct,
  recurring_productivity_sqft_per_hour: SYSTEM_DEFAULTS.recurring_productivity_sqft_per_hour,
  visits_per_year_default: PHASE35_DEFAULTS.visits_per_year_default,

  fuel_cost_per_mile: SYSTEM_DEFAULTS.fuel_cost_per_mile,
  vehicles_per_crew: SYSTEM_DEFAULTS.vehicles_per_crew,
  vehicle_lease_annual_per_crew: SYSTEM_DEFAULTS.vehicle_lease_annual_per_crew,
  drive_speed_mph: SYSTEM_DEFAULTS.drive_speed_mph,
  max_one_way_drive_minutes: SYSTEM_DEFAULTS.max_one_way_drive_minutes,

  surge_weeks_per_year: SYSTEM_DEFAULTS.surge_weeks_per_year,
  surge_crew_count: SYSTEM_DEFAULTS.surge_crew_count,
  surge_premium_multiplier: SYSTEM_DEFAULTS.surge_premium_multiplier,

  branch_overhead_annual: SYSTEM_DEFAULTS.branch_overhead_annual,
  hotels_annual: SYSTEM_DEFAULTS.hotels_annual,
  supplies_pct_of_labor: SYSTEM_DEFAULTS.supplies_pct_of_labor,
  insurance_annual: SYSTEM_DEFAULTS.insurance_annual,
  corporate_overhead_pct: SYSTEM_DEFAULTS.corporate_overhead_pct,
  target_gross_margin_pct: SYSTEM_DEFAULTS.target_gross_margin_pct,
}
