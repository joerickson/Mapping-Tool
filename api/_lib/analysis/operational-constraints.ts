// Per-account operational constraints loader.
// Loads the saved row from account_operational_constraints (if any) and merges
// it with the system defaults. Every analysis module calls
// `loadConstraints(db, accountId)` at the top of its handler so module code
// can just read `constraints.crew_size` and always get a number.
import type { SupabaseClient } from '@supabase/supabase-js'

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
}

export interface OperationalConstraints {
  account_id: string
  client_id: string | null
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
  hotels_annual: number
  vehicle_lease_annual_per_crew: number
  supplies_pct_of_labor: number
  insurance_annual: number

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

export async function loadConstraints(
  db: SupabaseClient,
  accountId: string
): Promise<OperationalConstraints> {
  const { data: row } = await db
    .from('account_operational_constraints')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()

  const r = (row ?? null) as any

  const merged: OperationalConstraints = {
    account_id: accountId,
    client_id: r?.client_id ?? null,
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
    vehicle_lease_annual_per_crew: pickNumeric(r, 'vehicle_lease_annual_per_crew'),
    supplies_pct_of_labor: pickNumeric(r, 'supplies_pct_of_labor'),
    insurance_annual: pickNumeric(r, 'insurance_annual'),
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
