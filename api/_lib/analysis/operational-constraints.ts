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

export { NUMERIC_KEYS }
