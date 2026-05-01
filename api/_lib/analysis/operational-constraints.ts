// Per-account operational constraints loader.
// Loads the saved row from account_operational_constraints (if any) and merges
// it with the system defaults. Every analysis module calls
// `loadConstraints(db, accountId)` at the top of its handler so module code
// can just read `constraints.crew_size` and always get a number.
import type { SupabaseClient } from '@supabase/supabase-js'

// Phase 4.3 — client-level scheduling preferences. Drives the routing
// engine's clustering radius and same-day pairing rules.
export interface SchedulingPreferences {
  cluster_radius_miles: number
  pairing_max_drive_minutes: number
  pairing_max_combined_sqft: number
  pairing_max_buildings_per_day: number
}

export const SCHEDULING_PREFERENCES_DEFAULTS: SchedulingPreferences = {
  cluster_radius_miles: 30,
  pairing_max_drive_minutes: 30,
  pairing_max_combined_sqft: 20000,
  pairing_max_buildings_per_day: 2,
}

export interface HotelCostConfig {
  cost_per_night: number
  overnight_trigger_one_way_hours: number
  max_work_hours_per_crew_day: number
  buffer_hours_per_day: number
  per_diem_per_night: number
  include_per_diem: boolean
}

export const HOTEL_COST_CONFIG_DEFAULTS: HotelCostConfig = {
  cost_per_night: 120,
  overnight_trigger_one_way_hours: 3,
  max_work_hours_per_crew_day: 8,
  buffer_hours_per_day: 2,
  per_diem_per_night: 50,
  include_per_diem: true,
}

export interface ExistingBranch {
  name: string
  address?: string | null
  lat: number
  lng: number
  locked?: boolean
}

// User's confirmed branch set, written by /api/accounts/[id]/select-branches.
// Source = 'existing' if the row mirrors an existing_branches entry, 'manual'
// if the user added it through the selection modal.
export interface SelectedBranch {
  name: string
  address?: string | null
  city_state: string
  lat: number
  lng: number
  source: 'existing' | 'manual'
  cluster_index?: number | null
  // Phase 3.9 — main vs satellite drives different overhead defaults.
  // Backward-compat: existing rows backfill to 'main' via migration.
  branch_type?: 'main' | 'satellite'
}

// Phase 3.9 — branch overhead structured config + per-branch overrides.
export interface BranchTypeDefaults {
  rent_monthly: number
  utilities_monthly: number
  manager_salary_annual: number
  manager_burden_pct: number
  other_operational_monthly: number
}
export interface BranchOverheadConfig {
  main_defaults: BranchTypeDefaults
  satellite_defaults: BranchTypeDefaults
}
export type BranchOverheadOverrides = Record<
  string,
  Partial<BranchTypeDefaults> & { branch_type?: 'main' | 'satellite' }
>

// Phase 3.9 — insurance config.
export interface InsuranceConfigShape {
  calculation_method: 'percentage_of_revenue' | 'flat'
  percentage_of_revenue?: number
  minimum_annual_premium?: number
  flat_amount?: number
}

// Phase 3.9 — vehicle config.
export interface VehicleConfigShape {
  default_vehicles_per_crew: number
  default_ownership_type: 'lease' | 'purchase' | 'personal_vehicle_reimbursement'
  ownership_defaults: {
    lease: {
      monthly_lease: number
      monthly_maintenance: number
      annual_registration: number
      annual_insurance: number
    }
    purchase: {
      monthly_payment: number
      monthly_maintenance: number
      annual_registration: number
      annual_insurance: number
      annual_depreciation_estimate: number
    }
    personal_vehicle_reimbursement: {
      rate_per_mile: number
      monthly_stipend: number
    }
  }
}

export interface OperationalConstraints {
  account_id: string
  client_id: string
  existing_branches: ExistingBranch[]
  excluded_property_ids: string[]
  excluded_property_reason: string | null

  // Crew economics
  crew_size: number
  hours_per_day: number
  hourly_loaded_labor_cost: number

  // Productivity rules
  project_clean_base_hours: number
  project_clean_hours_per_sqft: number
  upholstery_solo_hours: number
  upholstery_combo_hours_pct: number
  recurring_productivity_sqft_per_hour: number

  // Fuel / vehicle
  fuel_cost_per_mile: number
  vehicles_per_crew: number

  // Surge model
  surge_weeks_per_year: number
  surge_crew_count: number
  surge_premium_multiplier: number

  // Operational costs
  branch_overhead_annual: number
  // Legacy flat input — kept as a fallback for cases where the calculated
  // overnight cost can't be computed (no selected branches yet) and the
  // user hasn't set an override. Phase 3.7 introduced a calculated value.
  hotels_annual: number
  // Phase 3.7 — knobs for the calculated overnight cost.
  hotel_cost_config: HotelCostConfig
  // Phase 3.7 — when set, modules use this flat value INSTEAD of the
  // calculated number. Lets a user pin a contractual or matched figure.
  hotels_annual_override: number | null
  vehicle_lease_annual_per_crew: number
  supplies_pct_of_labor: number
  insurance_annual: number

  // Phase 3.9 — structured cost configs replace the flat fields above
  // when populated. Each has an _override numeric for hard-pin.
  branch_overhead_config: BranchOverheadConfig
  branch_overhead_overrides: BranchOverheadOverrides
  branch_overhead_annual_override: number | null
  insurance_config: InsuranceConfigShape
  insurance_annual_override: number | null
  vehicle_config: VehicleConfigShape
  vehicle_lease_annual_per_crew_override: number | null

  // Margin
  corporate_overhead_pct: number
  target_gross_margin_pct: number

  // Drive parameters
  drive_speed_mph: number
  max_one_way_drive_minutes: number

  // Phase 3.5 — additional cost-assumption fields surfaced on the panel
  working_days_per_year: number | null
  visits_per_year_default: number | null
  labor_burden_breakdown: {
    wages: boolean
    payroll_taxes: boolean
    workers_comp: boolean
    benefits: boolean
    training: boolean
  } | null

  // Branch Selection (Phase 2.5b) — null/empty until the user confirms
  // a branch set in the dashboard. Tier 2 modules require this to be set.
  selected_branches: SelectedBranch[] | null
  selected_k: number | null
  selected_at: string | null
  selected_from_analysis_id: string | null
  selected_by: string | null

  // Population constraint (Phase 2.5c) — branch optimization picks from
  // cities meeting these thresholds.
  population_constraint: {
    enabled: boolean
    min_population: number
    max_population?: number | null
    state_filter?: string[] | null
  }

  // Utilization band constraint (Phase 2.5d) — Crew Strategy sizes crews to
  // fit this band; status enum surfaces ideal/acceptable/under/over.
  utilization_constraint: {
    enabled: boolean
    hard_floor_pct: number
    soft_ceiling_pct: number
    ideal_min_pct: number
    ideal_max_pct: number
    scope: 'per_branch' | 'per_region' | 'portfolio'
  }

  // Phase 4.3 — scheduling preferences flowed into the routing engine.
  scheduling_preferences: SchedulingPreferences

  // Phase 4.2 — user picks one of A/B/C from Crew Strategy as the
  // "active" option flowed into Bid Pricing, Workforce Sizing, and
  // Seasonality. Null = use analysis's recommended_option.
  crew_strategy_selected_option: 'A' | 'B' | 'C' | null
  // Phase 4.2 — manual per-branch crew count override. When non-null
  // with at least one positive value, supersedes A/B/C selection
  // entirely. Total crew count = sum of values. Keys = branch names.
  crew_count_per_branch_override: Record<string, number> | null

  // Metadata
  updated_at: string | null
  updated_by: string | null
  has_saved_row: boolean
}

export const SYSTEM_DEFAULTS = {
  crew_size: 3,
  hours_per_day: 10,
  hourly_loaded_labor_cost: 28,
  project_clean_base_hours: 3,
  project_clean_hours_per_sqft: 0.0002,
  upholstery_solo_hours: 2,
  upholstery_combo_hours_pct: 0.6,
  recurring_productivity_sqft_per_hour: 3000,
  fuel_cost_per_mile: 0.18,
  vehicles_per_crew: 1,
  surge_weeks_per_year: 26,
  surge_crew_count: 3,
  surge_premium_multiplier: 1.4,
  branch_overhead_annual: 240000,
  hotels_annual: 35000,
  vehicle_lease_annual_per_crew: 8400,
  supplies_pct_of_labor: 0.04,
  insurance_annual: 18000,
  corporate_overhead_pct: 0.08,
  target_gross_margin_pct: 0.22,
  drive_speed_mph: 60,
  max_one_way_drive_minutes: 120,
} as const

export type SystemDefaults = typeof SYSTEM_DEFAULTS

// Numeric/integer fields that should fall through to defaults if the saved
// row has NULL. JSON / array fields are handled separately.
const NUMERIC_KEYS = Object.keys(SYSTEM_DEFAULTS) as (keyof SystemDefaults)[]

function pickNumeric(row: any, key: keyof SystemDefaults): number {
  const v = row?.[key]
  if (v == null) return SYSTEM_DEFAULTS[key]
  return typeof v === 'string' ? parseFloat(v) : v
}

// Phase 3.9 — defaults for the structured cost configs. Mirror the
// migration's COLUMN DEFAULT so the loader behaves the same whether
// a row exists with NULL or doesn't exist at all.
const BRANCH_OVERHEAD_CONFIG_DEFAULTS: BranchOverheadConfig = {
  main_defaults: {
    rent_monthly: 5000,
    utilities_monthly: 800,
    manager_salary_annual: 75000,
    manager_burden_pct: 28,
    other_operational_monthly: 2000,
  },
  satellite_defaults: {
    rent_monthly: 2500,
    utilities_monthly: 400,
    manager_salary_annual: 0,
    manager_burden_pct: 28,
    other_operational_monthly: 1000,
  },
}
const INSURANCE_CONFIG_DEFAULTS: InsuranceConfigShape = {
  calculation_method: 'percentage_of_revenue',
  percentage_of_revenue: 1.5,
  minimum_annual_premium: 5000,
}
const VEHICLE_CONFIG_DEFAULTS: VehicleConfigShape = {
  default_vehicles_per_crew: 1,
  default_ownership_type: 'lease',
  ownership_defaults: {
    lease: {
      monthly_lease: 600,
      monthly_maintenance: 150,
      annual_registration: 200,
      annual_insurance: 1800,
    },
    purchase: {
      monthly_payment: 800,
      monthly_maintenance: 200,
      annual_registration: 200,
      annual_insurance: 1600,
      annual_depreciation_estimate: 4000,
    },
    personal_vehicle_reimbursement: {
      rate_per_mile: 0.67,
      monthly_stipend: 0,
    },
  },
}

function mergeBranchOverheadConfig(saved: any): BranchOverheadConfig {
  if (!saved || typeof saved !== 'object') return clone(BRANCH_OVERHEAD_CONFIG_DEFAULTS)
  return {
    main_defaults: {
      ...BRANCH_OVERHEAD_CONFIG_DEFAULTS.main_defaults,
      ...(saved.main_defaults ?? {}),
    },
    satellite_defaults: {
      ...BRANCH_OVERHEAD_CONFIG_DEFAULTS.satellite_defaults,
      ...(saved.satellite_defaults ?? {}),
    },
  }
}
function mergeInsuranceConfig(saved: any): InsuranceConfigShape {
  if (!saved || typeof saved !== 'object') return clone(INSURANCE_CONFIG_DEFAULTS)
  return { ...INSURANCE_CONFIG_DEFAULTS, ...saved }
}
function mergeVehicleConfig(saved: any): VehicleConfigShape {
  if (!saved || typeof saved !== 'object') return clone(VEHICLE_CONFIG_DEFAULTS)
  return {
    default_vehicles_per_crew:
      saved.default_vehicles_per_crew ?? VEHICLE_CONFIG_DEFAULTS.default_vehicles_per_crew,
    default_ownership_type:
      saved.default_ownership_type ?? VEHICLE_CONFIG_DEFAULTS.default_ownership_type,
    ownership_defaults: {
      lease: {
        ...VEHICLE_CONFIG_DEFAULTS.ownership_defaults.lease,
        ...(saved.ownership_defaults?.lease ?? {}),
      },
      purchase: {
        ...VEHICLE_CONFIG_DEFAULTS.ownership_defaults.purchase,
        ...(saved.ownership_defaults?.purchase ?? {}),
      },
      personal_vehicle_reimbursement: {
        ...VEHICLE_CONFIG_DEFAULTS.ownership_defaults.personal_vehicle_reimbursement,
        ...(saved.ownership_defaults?.personal_vehicle_reimbursement ?? {}),
      },
    },
  }
}
function clone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T
}

function mergeSchedulingPreferences(saved: any): SchedulingPreferences {
  if (!saved || typeof saved !== 'object') {
    return { ...SCHEDULING_PREFERENCES_DEFAULTS }
  }
  return {
    cluster_radius_miles:
      typeof saved.cluster_radius_miles === 'number'
        ? saved.cluster_radius_miles
        : SCHEDULING_PREFERENCES_DEFAULTS.cluster_radius_miles,
    pairing_max_drive_minutes:
      typeof saved.pairing_max_drive_minutes === 'number'
        ? saved.pairing_max_drive_minutes
        : SCHEDULING_PREFERENCES_DEFAULTS.pairing_max_drive_minutes,
    pairing_max_combined_sqft:
      typeof saved.pairing_max_combined_sqft === 'number'
        ? saved.pairing_max_combined_sqft
        : SCHEDULING_PREFERENCES_DEFAULTS.pairing_max_combined_sqft,
    pairing_max_buildings_per_day:
      typeof saved.pairing_max_buildings_per_day === 'number'
        ? saved.pairing_max_buildings_per_day
        : SCHEDULING_PREFERENCES_DEFAULTS.pairing_max_buildings_per_day,
  }
}

function mergeHotelConfig(saved: any): HotelCostConfig {
  if (!saved || typeof saved !== 'object') return { ...HOTEL_COST_CONFIG_DEFAULTS }
  return {
    cost_per_night:
      typeof saved.cost_per_night === 'number' ? saved.cost_per_night : HOTEL_COST_CONFIG_DEFAULTS.cost_per_night,
    overnight_trigger_one_way_hours:
      typeof saved.overnight_trigger_one_way_hours === 'number'
        ? saved.overnight_trigger_one_way_hours
        : HOTEL_COST_CONFIG_DEFAULTS.overnight_trigger_one_way_hours,
    max_work_hours_per_crew_day:
      typeof saved.max_work_hours_per_crew_day === 'number'
        ? saved.max_work_hours_per_crew_day
        : HOTEL_COST_CONFIG_DEFAULTS.max_work_hours_per_crew_day,
    buffer_hours_per_day:
      typeof saved.buffer_hours_per_day === 'number'
        ? saved.buffer_hours_per_day
        : HOTEL_COST_CONFIG_DEFAULTS.buffer_hours_per_day,
    per_diem_per_night:
      typeof saved.per_diem_per_night === 'number'
        ? saved.per_diem_per_night
        : HOTEL_COST_CONFIG_DEFAULTS.per_diem_per_night,
    include_per_diem:
      typeof saved.include_per_diem === 'boolean'
        ? saved.include_per_diem
        : HOTEL_COST_CONFIG_DEFAULTS.include_per_diem,
  }
}

export async function loadConstraints(
  db: SupabaseClient,
  accountId: string,
  clientId: string
): Promise<OperationalConstraints> {
  const { data: row } = await db
    .from('account_operational_constraints')
    .select('*')
    .eq('account_id', accountId)
    .eq('client_id', clientId)
    .maybeSingle()

  const r = (row ?? null) as any

  const merged: OperationalConstraints = {
    account_id: accountId,
    client_id: clientId,
    existing_branches: (r?.existing_branches ?? []) as ExistingBranch[],
    excluded_property_ids: (r?.excluded_property_ids ?? []) as string[],
    excluded_property_reason: r?.excluded_property_reason ?? null,

    crew_size: pickNumeric(r, 'crew_size'),
    hours_per_day: pickNumeric(r, 'hours_per_day'),
    hourly_loaded_labor_cost: pickNumeric(r, 'hourly_loaded_labor_cost'),
    project_clean_base_hours: pickNumeric(r, 'project_clean_base_hours'),
    project_clean_hours_per_sqft: pickNumeric(r, 'project_clean_hours_per_sqft'),
    upholstery_solo_hours: pickNumeric(r, 'upholstery_solo_hours'),
    upholstery_combo_hours_pct: pickNumeric(r, 'upholstery_combo_hours_pct'),
    recurring_productivity_sqft_per_hour: pickNumeric(r, 'recurring_productivity_sqft_per_hour'),
    fuel_cost_per_mile: pickNumeric(r, 'fuel_cost_per_mile'),
    vehicles_per_crew: pickNumeric(r, 'vehicles_per_crew'),
    surge_weeks_per_year: pickNumeric(r, 'surge_weeks_per_year'),
    surge_crew_count: pickNumeric(r, 'surge_crew_count'),
    surge_premium_multiplier: pickNumeric(r, 'surge_premium_multiplier'),
    branch_overhead_annual: pickNumeric(r, 'branch_overhead_annual'),
    hotels_annual: pickNumeric(r, 'hotels_annual'),
    hotel_cost_config: mergeHotelConfig(r?.hotel_cost_config),
    hotels_annual_override:
      r?.hotels_annual_override == null
        ? null
        : typeof r.hotels_annual_override === 'string'
          ? parseFloat(r.hotels_annual_override)
          : r.hotels_annual_override,
    vehicle_lease_annual_per_crew: pickNumeric(r, 'vehicle_lease_annual_per_crew'),
    supplies_pct_of_labor: pickNumeric(r, 'supplies_pct_of_labor'),
    insurance_annual: pickNumeric(r, 'insurance_annual'),

    // Phase 3.9 — structured cost configs (with defaults if NULL).
    branch_overhead_config: mergeBranchOverheadConfig(r?.branch_overhead_config),
    branch_overhead_overrides: (r?.branch_overhead_overrides ?? {}) as BranchOverheadOverrides,
    branch_overhead_annual_override:
      r?.branch_overhead_annual_override == null
        ? null
        : typeof r.branch_overhead_annual_override === 'string'
          ? parseFloat(r.branch_overhead_annual_override)
          : r.branch_overhead_annual_override,
    insurance_config: mergeInsuranceConfig(r?.insurance_config),
    insurance_annual_override:
      r?.insurance_annual_override == null
        ? null
        : typeof r.insurance_annual_override === 'string'
          ? parseFloat(r.insurance_annual_override)
          : r.insurance_annual_override,
    vehicle_config: mergeVehicleConfig(r?.vehicle_config),
    vehicle_lease_annual_per_crew_override:
      r?.vehicle_lease_annual_per_crew_override == null
        ? null
        : typeof r.vehicle_lease_annual_per_crew_override === 'string'
          ? parseFloat(r.vehicle_lease_annual_per_crew_override)
          : r.vehicle_lease_annual_per_crew_override,

    corporate_overhead_pct: pickNumeric(r, 'corporate_overhead_pct'),
    target_gross_margin_pct: pickNumeric(r, 'target_gross_margin_pct'),
    drive_speed_mph: pickNumeric(r, 'drive_speed_mph'),
    max_one_way_drive_minutes: pickNumeric(r, 'max_one_way_drive_minutes'),

    working_days_per_year: r?.working_days_per_year ?? null,
    visits_per_year_default: r?.visits_per_year_default ?? null,
    labor_burden_breakdown: r?.labor_burden_breakdown ?? null,

    selected_branches: (r?.selected_branches ?? null) as SelectedBranch[] | null,
    selected_k: r?.selected_k ?? null,
    selected_at: r?.selected_at ?? null,
    selected_from_analysis_id: r?.selected_from_analysis_id ?? null,
    selected_by: r?.selected_by ?? null,

    population_constraint: {
      enabled: r?.population_constraint?.enabled ?? true,
      min_population: r?.population_constraint?.min_population ?? 50000,
      max_population: r?.population_constraint?.max_population ?? null,
      state_filter: r?.population_constraint?.state_filter ?? null,
    },

    utilization_constraint: {
      enabled: r?.utilization_constraint?.enabled ?? true,
      hard_floor_pct: r?.utilization_constraint?.hard_floor_pct ?? 75,
      soft_ceiling_pct: r?.utilization_constraint?.soft_ceiling_pct ?? 110,
      ideal_min_pct: r?.utilization_constraint?.ideal_min_pct ?? 80,
      ideal_max_pct: r?.utilization_constraint?.ideal_max_pct ?? 100,
      scope:
        (r?.utilization_constraint?.scope as
          | 'per_branch'
          | 'per_region'
          | 'portfolio') ?? 'per_branch',
    },

    scheduling_preferences: mergeSchedulingPreferences(r?.scheduling_preferences),

    crew_strategy_selected_option:
      r?.crew_strategy_selected_option === 'A' ||
      r?.crew_strategy_selected_option === 'B' ||
      r?.crew_strategy_selected_option === 'C'
        ? r.crew_strategy_selected_option
        : null,
    crew_count_per_branch_override:
      r?.crew_count_per_branch_override &&
      typeof r.crew_count_per_branch_override === 'object'
        ? (r.crew_count_per_branch_override as Record<string, number>)
        : null,

    updated_at: r?.updated_at ?? null,
    updated_by: r?.updated_by ?? null,
    has_saved_row: r != null,
  }

  return merged
}

// Helper for module endpoints: filter out properties that the account has
// excluded from analysis (e.g. served by another crew).
export function applyExclusions<T extends { id: string }>(
  properties: T[],
  excludedIds: string[]
): T[] {
  if (!excludedIds.length) return properties
  const set = new Set(excludedIds)
  return properties.filter((p) => !set.has(p.id))
}

// Tier 2 modules call this at the top of their handler. If no branches are
// selected, returns the canonical 400 error body so all five modules give
// identical guidance to the dashboard.
export const NO_SELECTION_ERROR = {
  error:
    'No branches selected. Run Branch Optimization and select branch locations first.',
  code: 'BRANCHES_NOT_SELECTED' as const,
}

export function requireSelectedBranches(
  constraints: OperationalConstraints
): { ok: true; branches: SelectedBranch[] } | { ok: false } {
  const selected = constraints.selected_branches
  if (!selected || selected.length === 0) return { ok: false }
  return { ok: true, branches: selected }
}

export { NUMERIC_KEYS }
