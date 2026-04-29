// Scenario orchestrator. Runs all 7 analysis modules in-process given a
// (possibly overridden) constraints object plus a chosen branch set, and
// returns the module outputs WITHOUT writing anything to portfolio_analyses.
// The scenario compute endpoint and chat's simulate_scenario tool both
// call this.
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  loadAccountProperties,
  type AccountProperty,
} from './account-data.js'
import {
  loadAccountOfferings,
  type OfferingRow,
} from './service-offerings.js'
import {
  applyExclusions,
  type OperationalConstraints,
  type SelectedBranch,
} from './operational-constraints.js'
import {
  computeGeographicDistribution,
} from '../../analyses/account/[accountId]/geographic-distribution.js'
import {
  computeBranchOptimization,
  type BranchOptInputs,
} from '../../analyses/account/[accountId]/branch-optimization.js'
import {
  computeDriveTimeLogistics,
  type DriveInputs,
} from '../../analyses/account/[accountId]/drive-time-logistics.js'
import {
  computeCrewStrategy,
  type CrewStrategyInputs,
} from '../../analyses/account/[accountId]/crew-strategy.js'
import {
  computeWorkforceSizing,
  type WorkforceInputs,
} from '../../analyses/account/[accountId]/workforce-sizing.js'
import {
  computeSeasonality,
  type SeasonalityInputs,
} from '../../analyses/account/[accountId]/seasonality-capacity.js'
import {
  computeBidPricing,
  type BidInputs,
} from '../../analyses/account/[accountId]/bid-pricing-structure.js'

export type ScenarioModuleResults = Partial<{
  geographic_distribution: { outputs: any; summary_text: string }
  branch_optimization: { outputs: any; summary_text: string }
  drive_time_logistics: { outputs: any; summary_text: string }
  crew_strategy: { outputs: any; summary_text: string }
  workforce_sizing: { outputs: any; summary_text: string }
  seasonality_capacity: { outputs: any; summary_text: string }
  bid_pricing_structure: { outputs: any; summary_text: string }
}>

export interface ScenarioOverrides {
  // Numeric constraint overrides — anything not provided falls back to baseline
  hourly_loaded_labor_cost?: number
  fuel_cost_per_mile?: number
  target_gross_margin_pct?: number
  surge_premium_multiplier?: number
  surge_crew_count?: number
  surge_weeks_per_year?: number
  branch_overhead_annual?: number
  hotels_annual?: number
  vehicle_lease_annual_per_crew?: number
  insurance_annual?: number
  corporate_overhead_pct?: number
  drive_speed_mph?: number
  max_one_way_drive_minutes?: number
  // Scenario-specific
  excluded_property_ids?: string[]
  // Branch-related overrides
  k_override?: number
  drop_branch_indices?: number[]
  selected_branches_override?: SelectedBranch[]
}

export interface RunScenarioInputs {
  baselineConstraints: OperationalConstraints
  overrides?: ScenarioOverrides
  modulesToRun?: Array<keyof ScenarioModuleResults> // default: all
}

export async function runAllModules(
  db: SupabaseClient,
  accountId: string,
  inputs: RunScenarioInputs
): Promise<ScenarioModuleResults> {
  const { baselineConstraints, overrides = {}, modulesToRun } = inputs

  // ── Effective constraints (numeric merge) ──────────────────────────────
  const c = { ...baselineConstraints }
  for (const k of [
    'hourly_loaded_labor_cost',
    'fuel_cost_per_mile',
    'target_gross_margin_pct',
    'surge_premium_multiplier',
    'surge_crew_count',
    'surge_weeks_per_year',
    'branch_overhead_annual',
    'hotels_annual',
    'vehicle_lease_annual_per_crew',
    'insurance_annual',
    'corporate_overhead_pct',
    'drive_speed_mph',
    'max_one_way_drive_minutes',
  ] as const) {
    const v = overrides[k]
    if (typeof v === 'number') (c as any)[k] = v
  }

  const effectiveExclusions = [
    ...c.excluded_property_ids,
    ...(overrides.excluded_property_ids ?? []),
  ]

  // ── Load shared data once ──────────────────────────────────────────────
  const allProps = await loadAccountProperties(db, accountId, c.client_id)
  const properties = applyExclusions(allProps, effectiveExclusions)
  const offerings = await loadAccountOfferings(db, accountId)

  // ── Resolve branches for this scenario ────────────────────────────────
  // Priority: explicit override > drop indices > k_override (re-runs branch
  // optimization at that K, uses computed centroids) > baseline selection.
  let scenarioBranches: SelectedBranch[] = c.selected_branches ?? []
  let scenarioK = c.selected_k ?? scenarioBranches.length

  if (overrides.selected_branches_override) {
    scenarioBranches = overrides.selected_branches_override
    scenarioK = scenarioBranches.length
  } else if (overrides.drop_branch_indices?.length) {
    const dropSet = new Set(overrides.drop_branch_indices)
    scenarioBranches = scenarioBranches.filter((_, i) => !dropSet.has(i))
    scenarioK = scenarioBranches.length
  }

  // If k_override changes K, run branch_optimization at that K and use the
  // optimization-computed centroids as the scenario's branches.
  let branchOptResult: { outputs: any; summary_text: string } | null = null
  const wantsRunBO =
    !modulesToRun || modulesToRun.includes('branch_optimization') ||
    overrides.k_override != null

  if (wantsRunBO) {
    const boInputs: BranchOptInputs = {
      client_id: c.client_id ?? null,
      k_range: [
        overrides.k_override ?? 1,
        overrides.k_override ?? 7,
      ],
      drive_speed_mph: c.drive_speed_mph,
      hourly_labor_cost: c.hourly_loaded_labor_cost,
      fuel_cost_per_mile: c.fuel_cost_per_mile,
      fixed_branch_cost_annual: c.branch_overhead_annual,
      existing_branches: c.existing_branches,
      population_constraint: c.population_constraint,
    }
    branchOptResult = await computeBranchOptimization(properties, boInputs)
  }

  if (overrides.k_override != null && branchOptResult?.outputs?.k_results?.length) {
    const row = branchOptResult.outputs.k_results.find(
      (r: any) => r.k === overrides.k_override
    )
    if (row?.branches?.length) {
      scenarioBranches = row.branches.map((b: any) => ({
        name: b.city_state,
        city_state: b.city_state,
        lat: b.lat,
        lng: b.lng,
        source: 'manual' as const,
      }))
      scenarioK = overrides.k_override
    }
  }

  // ── Run modules ───────────────────────────────────────────────────────
  const results: ScenarioModuleResults = {}
  const want = (k: keyof ScenarioModuleResults) => !modulesToRun || modulesToRun.includes(k)

  if (want('geographic_distribution')) {
    results.geographic_distribution = computeGeographicDistribution(
      properties,
      allProps.length - properties.length
    )
  }

  if (want('branch_optimization') && branchOptResult) {
    results.branch_optimization = branchOptResult
  }

  // Tier 2 modules — only valid if we actually have branches
  if (scenarioBranches.length === 0) {
    return results // skip Tier 2 entirely
  }

  const branchesForTier2 = scenarioBranches.map((b) => ({
    name: b.name,
    lat: b.lat,
    lng: b.lng,
  }))

  if (want('drive_time_logistics')) {
    const driveInputs: DriveInputs = {
      client_id: c.client_id ?? null,
      k: scenarioK,
      branches: undefined,
      drive_speed_mph: c.drive_speed_mph,
      max_one_way_drive_minutes: c.max_one_way_drive_minutes,
    }
    results.drive_time_logistics = computeDriveTimeLogistics(
      properties,
      branchesForTier2,
      driveInputs,
      scenarioK
    )
  }

  let crewStrategyResult: { outputs: any; summary_text: string } | undefined
  if (want('crew_strategy')) {
    const crewInputs: CrewStrategyInputs = {
      client_id: c.client_id ?? null,
      k: scenarioK,
      branches: branchesForTier2,
      crew_size: c.crew_size,
      hours_per_day: c.hours_per_day,
      hourly_loaded_labor_cost: c.hourly_loaded_labor_cost,
      project_clean_base_hours: c.project_clean_base_hours,
      project_clean_hours_per_sqft: c.project_clean_hours_per_sqft,
      upholstery_solo_hours: c.upholstery_solo_hours,
      upholstery_combo_hours_pct: c.upholstery_combo_hours_pct,
      visits_per_year_default: 2,
      surge_weeks_per_year: c.surge_weeks_per_year,
      surge_crew_count: c.surge_crew_count,
      surge_premium_multiplier: c.surge_premium_multiplier,
      fuel_cost_per_mile: c.fuel_cost_per_mile,
      vehicles_per_crew: c.vehicles_per_crew,
      utilization_constraint: c.utilization_constraint,
    }
    crewStrategyResult = computeCrewStrategy(
      properties,
      offerings as Map<string, OfferingRow>,
      branchesForTier2,
      scenarioK,
      crewInputs
    )
    results.crew_strategy = crewStrategyResult
  }

  if (want('workforce_sizing')) {
    const wfInputs: WorkforceInputs = {
      client_id: c.client_id ?? null,
      productivity_sqft_per_hour: c.recurring_productivity_sqft_per_hour,
      fte_hours_per_year: 1880,
      part_time_avg_hours_per_week: 25,
      workforce_b_offerings: null,
      recurring_visits_per_year_default: 52,
    }
    results.workforce_sizing = computeWorkforceSizing(
      properties,
      offerings as Map<string, OfferingRow>,
      crewStrategyResult?.outputs ?? null,
      wfInputs
    )
  }

  if (want('seasonality_capacity')) {
    const seasonalityInputs: SeasonalityInputs = {
      client_id: c.client_id ?? null,
      windows: {
        summer_break: { start_month: 6, start_day: 1, end_month: 8, end_day: 15 },
        winter_break: { start_month: 12, start_day: 18, end_month: 1, end_day: 6 },
        spring_break: { start_month: 3, start_day: 15, end_month: 3, end_day: 25 },
      },
      crew_size: c.crew_size,
      hours_per_day: c.hours_per_day,
      project_clean_base_hours: c.project_clean_base_hours,
      project_clean_hours_per_sqft: c.project_clean_hours_per_sqft,
      visits_per_year_default: 2,
    }
    results.seasonality_capacity = computeSeasonality(
      properties,
      offerings as Map<string, OfferingRow>,
      crewStrategyResult?.outputs ?? null,
      seasonalityInputs
    )
  }

  if (want('bid_pricing_structure')) {
    const bidInputs: BidInputs = {
      client_id: c.client_id ?? null,
      total_annual_labor_cost: null,
      total_annual_vehicle_cost: null,
      fte_count: null,
      hotels_annual: c.hotels_annual,
      branch_overhead_annual: c.branch_overhead_annual,
      vehicle_lease_annual_per_crew: c.vehicle_lease_annual_per_crew,
      supplies_pct_of_labor: c.supplies_pct_of_labor,
      insurance_annual: c.insurance_annual,
      corporate_overhead_pct: c.corporate_overhead_pct,
      target_gross_margin_pct: c.target_gross_margin_pct,
      branch_count: scenarioK,
      crew_count: null,
    }
    results.bid_pricing_structure = computeBidPricing(
      properties,
      bidInputs,
      crewStrategyResult?.outputs ?? null,
      branchOptResult?.outputs ?? null,
      results.workforce_sizing?.outputs ?? null
    )
  }

  return results
}

// Convenience: pull headline numbers from the bid_pricing + crew_strategy
// outputs so the dashboard can render side-by-side baseline/scenario deltas.
export function summarizeForCompare(results: ScenarioModuleResults) {
  return {
    bid_total: results.bid_pricing_structure?.outputs?.bid_total ?? null,
    bid_per_property:
      results.bid_pricing_structure?.outputs?.bid_per_property ?? null,
    monthly_invoice_estimate:
      results.bid_pricing_structure?.outputs?.monthly_invoice_estimate ?? null,
    margin_pct:
      results.bid_pricing_structure?.outputs?.margin?.target_pct ?? null,
    crew_recommended_option:
      results.crew_strategy?.outputs?.recommended_option ?? null,
    crew_total_annual_cost:
      results.crew_strategy?.outputs?.options?.[
        results.crew_strategy?.outputs?.recommended_option
      ]?.total_annual_cost ?? null,
    branch_count_recommended:
      results.branch_optimization?.outputs?.recommended_k ?? null,
    properties_within_60min_pct:
      ((results.drive_time_logistics?.outputs?.drive_distribution?.under_30_min ?? 0) +
        (results.drive_time_logistics?.outputs?.drive_distribution?.['30_to_60_min'] ?? 0)) ||
      null,
  }
}
