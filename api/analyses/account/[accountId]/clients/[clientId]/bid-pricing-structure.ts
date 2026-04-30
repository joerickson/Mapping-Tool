// POST /api/analyses/[accountId]/bid-pricing-structure
// Builds a complete bid pricing model: cost buildup → corporate overhead →
// margin → final bid. Pulls prior modules' outputs as defaults so the user
// can iterate by re-running just one upstream module.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../../../_lib/supabase.js'
import { authenticateRequest } from '../../../../../_lib/auth.js'
import {
  loadAccountProperties,
  createAnalysisRecord,
  completeAnalysisRecord,
  failAnalysisRecord,
  fetchLatestCompletedAnalysis,
} from '../../../../../_lib/analysis/account-data.js'
import {
  loadConstraints,
  applyExclusions,
  requireSelectedBranches,
  NO_SELECTION_ERROR,
} from '../../../../../_lib/analysis/operational-constraints.js'
import { loadAccountOfferings, classifyOffering } from '../../../../../_lib/analysis/service-offerings.js'
import { computePropertyVisitHours } from '../../../../../_lib/analysis/property-hours.js'
import {
  calculateOvernights,
  resolveHotelsCost,
  type OvernightConfig,
  type ResolvedHotelsCost,
} from '../../../../../_lib/analysis/overnight-calculator.js'
import {
  calculateBranchOverhead,
  type BranchOverheadResult,
} from '../../../../../_lib/analysis/branch-overhead-calculator.js'
import {
  calculateInsurance,
  type InsuranceResult,
} from '../../../../../_lib/analysis/insurance-calculator.js'
import {
  calculateVehicleCosts,
  type VehicleCostResult,
} from '../../../../../_lib/analysis/vehicle-cost-calculator.js'
import {
  calculateServiceLineBid,
  type ServiceLineBidResult,
  type ServiceLineConfig,
  type ServiceLinePropertyInput,
} from '../../../../../_lib/analysis/service-line-bid-calculator.js'

export const config = { maxDuration: 60 }

export interface BidInputs {
  client_id?: string | null
  total_annual_labor_cost: number | null
  total_annual_vehicle_cost: number | null
  fte_count: number | null
  hotels_annual: number
  branch_overhead_annual: number
  vehicle_lease_annual_per_crew: number
  supplies_pct_of_labor: number
  insurance_annual: number
  corporate_overhead_pct: number
  target_gross_margin_pct: number
  branch_count: number | null
  crew_count: number | null
  // Phase 4.2 — user-picked crew strategy option (overrides the
  // analysis's recommended_option). Falls back to recommended when
  // null.
  crew_strategy_selected_option?: 'A' | 'B' | 'C' | null
  // Phase 4.2 — manual per-branch crew count override. When set with
  // any non-zero values, bid pricing ignores A/B/C and uses these
  // counts directly. Total crews = sum of values. Keyed by branch name.
  crew_count_per_branch_override?: Record<string, number> | null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let ctx: Awaited<ReturnType<typeof authenticateRequest>>
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const accountId = req.query.accountId as string
  const clientId = req.query.clientId as string
  const body = (req.body ?? {}) as Partial<BidInputs>
  const db = createAdminClient()
  const constraints = await loadConstraints(db, accountId, clientId)

  // Tier 2: requires the user to have confirmed a branch selection.
  const sel = requireSelectedBranches(constraints)
  if (!sel.ok) return res.status(400).json(NO_SELECTION_ERROR)

  const inputs: BidInputs = {
    client_id: body.client_id ?? constraints.client_id ?? null,
    total_annual_labor_cost: body.total_annual_labor_cost ?? null,
    total_annual_vehicle_cost: body.total_annual_vehicle_cost ?? null,
    fte_count: body.fte_count ?? null,
    hotels_annual: body.hotels_annual ?? constraints.hotels_annual,
    branch_overhead_annual: body.branch_overhead_annual ?? constraints.branch_overhead_annual,
    vehicle_lease_annual_per_crew:
      body.vehicle_lease_annual_per_crew ?? constraints.vehicle_lease_annual_per_crew,
    supplies_pct_of_labor: body.supplies_pct_of_labor ?? constraints.supplies_pct_of_labor,
    insurance_annual: body.insurance_annual ?? constraints.insurance_annual,
    corporate_overhead_pct:
      body.corporate_overhead_pct ?? constraints.corporate_overhead_pct,
    target_gross_margin_pct:
      body.target_gross_margin_pct ?? constraints.target_gross_margin_pct,
    branch_count: body.branch_count ?? null,
    crew_count: body.crew_count ?? null,
    crew_strategy_selected_option:
      ((constraints as any).crew_strategy_selected_option as
        | 'A' | 'B' | 'C' | null
        | undefined) ?? null,
    crew_count_per_branch_override:
      ((constraints as any).crew_count_per_branch_override as
        | Record<string, number>
        | null
        | undefined) ?? null,
  }

  let analysisId: string
  try {
    analysisId = await createAnalysisRecord(db, {
      account_id: accountId,
      client_id: clientId,
      module_key: 'bid_pricing_structure',
      inputs: inputs as unknown as Record<string, unknown>,
      created_by: ctx.userId ?? null,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message ?? 'Failed to create analysis record' })
  }

  try {
    const allProperties = await loadAccountProperties(db, accountId, clientId)
    const properties = applyExclusions(allProperties, constraints.excluded_property_ids)

    if (inputs.branch_count == null) {
      inputs.branch_count = constraints.selected_k ?? sel.branches.length
    }

    const crewStrategy = await fetchLatestCompletedAnalysis(db, accountId, clientId, 'crew_strategy')
    const branchOpt = await fetchLatestCompletedAnalysis(db, accountId, clientId, 'branch_optimization')
    const workforce = await fetchLatestCompletedAnalysis(db, accountId, clientId, 'workforce_sizing')

    // Phase 3.8 — when an active routing template exists for this client,
    // the scheduler's actual numbers are the source of truth. Prefer them
    // over Crew Strategy's pre-scheduler estimate.
    const { data: schedulerTemplateRow } = await db
      .from('routing_templates')
      .select(
        'id, name, crew_count, cycle_length_days, total_drive_miles_per_cycle, total_work_minutes_per_cycle, total_overnight_nights_per_cycle, total_estimated_cost_per_year'
      )
      .eq('account_id', accountId)
      .eq('client_id', clientId)
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const schedulerTemplate = (schedulerTemplateRow as any) ?? null

    // Phase 3.7 — calculate overnight cost from selected branches + property
    // visit hours, then resolve final hotels value (override / calc / flat).
    const offerings = await loadAccountOfferings(db, accountId, clientId)
    const visits = computePropertyVisitHours(properties, offerings, {
      project_clean_base_hours: constraints.project_clean_base_hours,
      project_clean_hours_per_sqft: constraints.project_clean_hours_per_sqft,
      upholstery_solo_hours: constraints.upholstery_solo_hours,
      upholstery_combo_hours_pct: constraints.upholstery_combo_hours_pct,
      visits_per_year_default: constraints.visits_per_year_default ?? 2,
    })
    const overnightConfig: OvernightConfig = {
      drive_speed_mph: constraints.drive_speed_mph,
      overnight_trigger_one_way_hours: constraints.hotel_cost_config.overnight_trigger_one_way_hours,
      max_work_hours_per_crew_day: constraints.hotel_cost_config.max_work_hours_per_crew_day,
      buffer_hours_per_day: constraints.hotel_cost_config.buffer_hours_per_day,
      crew_size: constraints.crew_size,
      cost_per_night: constraints.hotel_cost_config.cost_per_night,
      per_diem_per_night: constraints.hotel_cost_config.per_diem_per_night,
      include_per_diem: constraints.hotel_cost_config.include_per_diem,
    }
    const overnightInput = visits
      .filter((v) => v.property.latitude != null && v.property.longitude != null && v.hours_per_visit > 0)
      .map((v) => ({
        id: v.property.id,
        address: v.property.address_line1,
        lat: v.property.latitude as number,
        lng: v.property.longitude as number,
        visits_per_year: v.visits_per_year,
        hours_per_visit: v.hours_per_visit,
      }))
    const calc = calculateOvernights(
      overnightInput,
      sel.branches.map((b) => ({ name: b.name, lat: b.lat, lng: b.lng })),
      overnightConfig
    )
    const hotelsResolved = resolveHotelsCost(
      calc,
      constraints.hotels_annual_override,
      constraints.hotels_annual,
      overnightConfig
    )

    // Pin the resolved value into inputs so computeBidPricing uses it.
    inputs.hotels_annual = hotelsResolved.value

    // Phase 3.9 — structured branch overhead.
    let branchOverheadResult: BranchOverheadResult | null = null
    if (constraints.branch_overhead_annual_override == null) {
      branchOverheadResult = calculateBranchOverhead({
        branches: sel.branches.map((b) => ({
          name: b.name,
          branch_type: b.branch_type ?? 'main',
          lat: b.lat,
          lng: b.lng,
        })),
        config: constraints.branch_overhead_config,
        per_branch_overrides: constraints.branch_overhead_overrides,
      })
      // Override the legacy flat input with the calculated total / branch.
      // The legacy code multiplies by branch_count, so we hand it the
      // per-branch average to keep the math consistent.
      const k = sel.branches.length
      inputs.branch_overhead_annual =
        k > 0 ? Math.round(branchOverheadResult.total_annual / k) : 0
    } else {
      inputs.branch_overhead_annual = constraints.branch_overhead_annual_override
    }

    // Phase 3.9 — structured vehicle costs.
    let vehicleResult: VehicleCostResult | null = null
    const desiredCrewCount = inputs.crew_count ?? 4
    if (constraints.vehicle_lease_annual_per_crew_override == null) {
      vehicleResult = await calculateVehicleCosts({
        db,
        account_id: accountId,
        client_id: clientId,
        crew_count: desiredCrewCount,
        // Rough proxy: assume 30k miles/yr/crew if no scheduler data
        // (matches the legacy ROVING_ESTIMATED_ANNUAL_MILES_PER_CREW
        // constant in crew-strategy).
        estimated_annual_drive_miles_per_crew: 30000,
        config: constraints.vehicle_config,
      })
      const k = vehicleResult.crews.length
      inputs.vehicle_lease_annual_per_crew =
        k > 0 ? Math.round(vehicleResult.total_annual / k) : 0
    } else {
      inputs.vehicle_lease_annual_per_crew =
        constraints.vehicle_lease_annual_per_crew_override
    }

    // Phase 3.9 — insurance two-pass. Pass 1: compute bid with the
    // legacy flat insurance (or override). Pass 2: derive insurance
    // from pass-1 revenue and re-compute. The delta on a typical bid
    // is < 0.05%, well within the noise of other inputs.
    let insuranceResult: InsuranceResult | null = null
    if (constraints.insurance_annual_override == null) {
      // Pass 1 with current insurance value (don't zero it; that
      // throws off the corporate_overhead × insurance multiplier).
      const pass1 = computeBidPricing(
        properties,
        { ...inputs },
        crewStrategy?.outputs,
        branchOpt?.outputs,
        workforce?.outputs,
        hotelsResolved,
        schedulerTemplate,
        offerings,
        {
          project_clean_base_hours: constraints.project_clean_base_hours,
          project_clean_hours_per_sqft: constraints.project_clean_hours_per_sqft,
          upholstery_solo_hours: constraints.upholstery_solo_hours,
          upholstery_combo_hours_pct: constraints.upholstery_combo_hours_pct,
          visits_per_year_default: constraints.visits_per_year_default ?? 2,
        }
      )
      insuranceResult = calculateInsurance({
        config: constraints.insurance_config,
        estimated_annual_revenue: pass1.outputs.bid_total,
      })
      inputs.insurance_annual = insuranceResult.calculated_amount
    } else {
      inputs.insurance_annual = constraints.insurance_annual_override
    }

    // Phase 3.9 — exclude personal-vehicle crews from fuel allocation.
    if (
      vehicleResult &&
      vehicleResult.fuel_excluded_crew_labels.length > 0 &&
      inputs.total_annual_vehicle_cost == null
    ) {
      // resolvedVehicleFuel will be filled from crewStrategy below; we
      // pre-scale it by the fraction of crews actually paying for fuel.
      const totalCrews = vehicleResult.crews.length
      const fueled = totalCrews - vehicleResult.fuel_excluded_crew_labels.length
      if (totalCrews > 0 && fueled >= 0) {
        // Stash on a non-input field so computeBidPricing can apply.
        ;(inputs as any).__fuel_scale = fueled / totalCrews
      }
    }

    const result = computeBidPricing(
      properties,
      inputs,
      crewStrategy?.outputs,
      branchOpt?.outputs,
      workforce?.outputs,
      hotelsResolved,
      schedulerTemplate,
      offerings,
      {
        project_clean_base_hours: constraints.project_clean_base_hours,
        project_clean_hours_per_sqft: constraints.project_clean_hours_per_sqft,
        upholstery_solo_hours: constraints.upholstery_solo_hours,
        upholstery_combo_hours_pct: constraints.upholstery_combo_hours_pct,
        visits_per_year_default: constraints.visits_per_year_default ?? 2,
      },
      branchOverheadResult,
      insuranceResult,
      vehicleResult
    )

    // Phase 4 — service line bid pricing. Loads per-(account, client,
    // offering) pricing config, groups properties by offering, and
    // delegates to the service-line calculator. Emitted alongside the
    // existing cost_buildup so legacy chart consumers still work.
    let serviceLineBid: ServiceLineBidResult | null = null
    try {
      serviceLineBid = await computeServiceLineBid({
        db,
        accountId,
        clientId,
        properties,
        offerings,
        constraints,
        result,
        branchOverheadResult,
        insuranceResult,
        vehicleResult,
        hotelsResolved,
        crewStrategyOutputs: crewStrategy?.outputs,
      })
    } catch (err: any) {
      console.error('[bid-pricing] service-line calc failed:', err?.message ?? err)
    }
    if (serviceLineBid) {
      ;(result.outputs as any).service_line_bid = serviceLineBid
    }

    await completeAnalysisRecord(db, analysisId, {
      outputs: result.outputs,
      summary_text: result.summary_text,
      property_count: properties.length,
    })
    return res.status(200).json({ analysis_id: analysisId, status: 'completed' })
  } catch (err: any) {
    const msg = err?.message ?? String(err)
    await failAnalysisRecord(db, analysisId, msg)
    return res.status(500).json({ analysis_id: analysisId, status: 'failed', error: msg })
  }
}

export type BidPricingSource =
  | 'scheduler_template'
  | 'crew_strategy_estimate'
  | 'manual_override'

export function computeBidPricing(
  properties: Awaited<ReturnType<typeof loadAccountProperties>>,
  inputs: BidInputs,
  crewStrategyOutputs: any,
  branchOptOutputs: any,
  workforceOutputs: any,
  hotelsResolved?: ResolvedHotelsCost,
  schedulerTemplate?: {
    id: string
    name: string
    crew_count: number
    cycle_length_days: number
    total_drive_miles_per_cycle: number | null
    total_work_minutes_per_cycle: number | null
    total_overnight_nights_per_cycle: number | null
  } | null,
  offerings?: Map<string, { id: string; name: string }>,
  hoursInputs?: {
    project_clean_base_hours: number
    project_clean_hours_per_sqft: number
    upholstery_solo_hours: number
    upholstery_combo_hours_pct: number
    visits_per_year_default: number
  },
  branchOverheadResult?: BranchOverheadResult | null,
  insuranceResult?: InsuranceResult | null,
  vehicleResult?: VehicleCostResult | null
) {
  let resolvedLabor = inputs.total_annual_labor_cost
  let resolvedVehicleFuel = inputs.total_annual_vehicle_cost
  let resolvedCrewCount = inputs.crew_count
  let recommendedOption: string | null = null

  // Phase 4.2 — manual per-branch crew override. When the user has
  // entered explicit crew counts per branch, sum them for the total
  // crew count and treat this as the highest-priority source. Labor
  // is then recomputed proportionally from the override total using
  // the original Option B (or A if A is selected) per-crew rate so
  // working_days_per_year / hours_per_day / hourly_loaded_labor_cost
  // assumptions remain consistent with the analysis.
  const perBranchOverride = inputs.crew_count_per_branch_override
  const overrideTotalCrews =
    perBranchOverride && typeof perBranchOverride === 'object'
      ? Object.values(perBranchOverride).reduce(
          (s, v) => s + (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0),
          0
        )
      : 0
  const hasOverride = overrideTotalCrews > 0

  // Phase 3.8 — track where each number actually came from. Manual
  // overrides win, then scheduler template, then crew_strategy estimate.
  const manualOverride =
    inputs.crew_count != null ||
    inputs.total_annual_labor_cost != null ||
    inputs.total_annual_vehicle_cost != null ||
    hasOverride
  let source: BidPricingSource = manualOverride
    ? 'manual_override'
    : schedulerTemplate
      ? 'scheduler_template'
      : 'crew_strategy_estimate'

  // Scheduler template wins when present — it's the actual operational plan.
  if (schedulerTemplate && !manualOverride) {
    if (resolvedCrewCount == null) resolvedCrewCount = schedulerTemplate.crew_count
  }

  if (crewStrategyOutputs) {
    // Phase 4.2 — user can override the analysis's recommended_option
    // by clicking a card in CrewStrategyChart. Selection arrives via
    // inputs.crew_strategy_selected_option (passed through from
    // account_operational_constraints).
    const userSelected = inputs.crew_strategy_selected_option
    recommendedOption = (userSelected && ['A', 'B', 'C'].includes(userSelected))
      ? userSelected
      : crewStrategyOutputs.recommended_option
    const opt = crewStrategyOutputs.options?.[recommendedOption ?? '']
    if (opt) {
      if (resolvedLabor == null) resolvedLabor = opt.annual_labor_cost
      if (resolvedVehicleFuel == null) resolvedVehicleFuel = opt.annual_vehicle_cost
      if (resolvedCrewCount == null) {
        resolvedCrewCount =
          (opt.crew_count ?? 0) +
          (recommendedOption === 'C' ? opt.surge_crew_count ?? 0 : 0)
      }
    }

    // If the user supplied a per-branch override, replace crew count
    // and rescale labor + vehicle from the option's per-crew unit cost.
    // We use option B (the dedicated-per-branch option) as the unit
    // basis since it's the most apples-to-apples for "N crews".
    if (hasOverride) {
      const baseOpt = crewStrategyOutputs.options?.B ?? opt
      const baseCrews = Number(baseOpt?.crew_count ?? 0)
      const perCrewLabor =
        baseCrews > 0 ? Number(baseOpt?.annual_labor_cost ?? 0) / baseCrews : 0
      const perCrewVehicle =
        baseCrews > 0 ? Number(baseOpt?.annual_vehicle_cost ?? 0) / baseCrews : 0
      resolvedCrewCount = overrideTotalCrews
      resolvedLabor = Math.round(perCrewLabor * overrideTotalCrews)
      resolvedVehicleFuel = Math.round(perCrewVehicle * overrideTotalCrews)
    }
  }

  let resolvedBranchCount = inputs.branch_count
  if (resolvedBranchCount == null && branchOptOutputs?.recommended_k) {
    resolvedBranchCount = branchOptOutputs.recommended_k
  }
  resolvedBranchCount = resolvedBranchCount ?? 4
  resolvedCrewCount = resolvedCrewCount ?? resolvedBranchCount + 1

  if (resolvedLabor == null) {
    throw new Error(
      'No labor cost available. Run Crew Strategy first, or pass total_annual_labor_cost in the request body.'
    )
  }
  if (resolvedVehicleFuel == null) resolvedVehicleFuel = 0

  const fteCount =
    inputs.fte_count ??
    (workforceOutputs?.total_workforce_size?.fte_equivalent as number | undefined) ??
    null

  const totalSqft = properties.reduce(
    (sum, p) =>
      sum +
      p.service_locations.reduce((s, sl) => s + (sl.serviceable_sqft ?? 0), 0),
    0
  )

  const direct_labor = resolvedLabor
  // Phase 3.9 — fuel scale removes the slice attributable to crews on
  // personal-vehicle reimbursement (the IRS mileage rate already covers
  // gas, so double-counting here would inflate the bid).
  const fuelScale = (inputs as any).__fuel_scale
  const vehicle_fuel =
    typeof fuelScale === 'number' && Number.isFinite(fuelScale)
      ? Math.round(resolvedVehicleFuel * fuelScale)
      : resolvedVehicleFuel
  const vehicle_lease = resolvedCrewCount * inputs.vehicle_lease_annual_per_crew
  const hotels = inputs.hotels_annual
  const supplies = direct_labor * inputs.supplies_pct_of_labor
  const branch_overhead = resolvedBranchCount * inputs.branch_overhead_annual
  const insurance = inputs.insurance_annual

  const total_direct_cost =
    direct_labor + vehicle_fuel + vehicle_lease + hotels + supplies + branch_overhead + insurance

  const corporate_overhead = total_direct_cost * inputs.corporate_overhead_pct
  const total_cost = total_direct_cost + corporate_overhead

  const bid_total =
    inputs.target_gross_margin_pct < 1 ? total_cost / (1 - inputs.target_gross_margin_pct) : 0
  const margin_amount = bid_total - total_cost

  const bid_per_property = properties.length > 0 ? bid_total / properties.length : 0
  const monthly_invoice_estimate = bid_total / 12

  // ── Phase 3.9 — per-service-line $/sqft breakdown ───────────────────
  // Walk every SL, classify by offering, and roll up sqft + work hours
  // per category. Project lines (project_clean, upholstery) report
  // $/sqft/visit (visit-weighted denominator); recurring janitorial
  // reports $/sqft/year. Allocates bid_total proportional to work
  // hours per line, which matches the labor-driven bid model.
  const lines = computePerServiceLine(properties, offerings, hoursInputs, bid_total)

  const pct = (n: number) =>
    bid_total > 0 ? Math.round((n / bid_total) * 1000) / 10 : 0
  const cost_breakdown_pct = {
    labor: pct(direct_labor),
    vehicle: pct(vehicle_fuel + vehicle_lease),
    overhead: pct(branch_overhead + corporate_overhead + hotels + insurance + supplies),
    margin: pct(margin_amount),
    other: 0,
  }

  const summaryParts: string[] = []
  summaryParts.push(
    `Recommended bid: $${(bid_total / 1_000_000).toFixed(2)}M annually = $${Math.round(
      bid_per_property
    ).toLocaleString()}/property/year.`
  )
  summaryParts.push(
    `Cost structure: ${cost_breakdown_pct.labor}% labor, ${cost_breakdown_pct.vehicle}% vehicle/fuel, ${cost_breakdown_pct.overhead}% overhead, ${cost_breakdown_pct.margin}% margin.`
  )
  summaryParts.push(
    `Monthly invoice estimate: $${Math.round(monthly_invoice_estimate).toLocaleString()}.`
  )
  if (source === 'scheduler_template' && schedulerTemplate) {
    summaryParts.push(
      `Crew count from active scheduler template "${schedulerTemplate.name}" (${resolvedCrewCount} crews).`
    )
  } else if (source === 'manual_override') {
    summaryParts.push('Crew count + costs from manual override.')
  } else if (recommendedOption) {
    summaryParts.push(`Labor pulled from Crew Strategy Option ${recommendedOption}.`)
  }

  return {
    outputs: {
      property_count: properties.length,
      total_sqft: totalSqft,
      sourced_from: {
        crew_strategy_option: recommendedOption,
        crew_count: resolvedCrewCount,
        branch_count: resolvedBranchCount,
        fte_count: fteCount,
        source,
        scheduler_template: schedulerTemplate
          ? { id: schedulerTemplate.id, name: schedulerTemplate.name }
          : null,
      },
      cost_buildup: {
        direct_labor: Math.round(direct_labor),
        vehicle_fuel: Math.round(vehicle_fuel),
        vehicle_lease: Math.round(vehicle_lease),
        // Phase 3.7 — hotels is now structured. When the caller hasn't passed
        // hotelsResolved (e.g. body.hotels_annual override path), fall back
        // to a minimal flat shape so consumers can still read .total.
        hotels: hotelsResolved
          ? {
              total: Math.round(hotelsResolved.value),
              hotel_room_cost: hotelsResolved.hotel_room_cost,
              per_diem_cost: hotelsResolved.per_diem_cost,
              basis: hotelsResolved.basis,
              calculated_value: hotelsResolved.calculated_value,
              breakdown: {
                total_nights: hotelsResolved.total_nights,
                cost_per_night: hotelsResolved.cost_per_night,
                crew_size: hotelsResolved.crew_size,
                per_diem_per_night: hotelsResolved.per_diem_per_night,
                cluster_count: hotelsResolved.cluster_count,
                properties_requiring_overnight: hotelsResolved.properties_requiring_overnight,
              },
            }
          : { total: Math.round(hotels), basis: 'flat_fallback' as const },
        supplies: Math.round(supplies),
        // Phase 3.9 — structured branch overhead. Falls back to flat
        // when override is in effect (no breakdown to show).
        branch_overhead: branchOverheadResult
          ? {
              total: Math.round(branch_overhead),
              basis: 'calculated' as const,
              breakdown: {
                main_count: branchOverheadResult.main_count,
                satellite_count: branchOverheadResult.satellite_count,
                per_branch: branchOverheadResult.branches,
                total: branchOverheadResult.total_annual,
              },
            }
          : { total: Math.round(branch_overhead), basis: 'override' as const },
        // Phase 3.9 — structured insurance.
        insurance: insuranceResult
          ? {
              total: Math.round(insurance),
              basis: 'calculated' as const,
              breakdown: {
                method: insuranceResult.applied_method,
                applied_percentage: insuranceResult.applied_percentage,
                basis_amount: insuranceResult.basis_amount,
                hit_minimum: insuranceResult.hit_minimum,
                breakdown_text: insuranceResult.breakdown_text,
              },
            }
          : { total: Math.round(insurance), basis: 'override' as const },
        // Phase 3.9 — structured vehicle costs.
        vehicle_costs: vehicleResult
          ? {
              total: Math.round(vehicle_lease),
              basis: 'calculated' as const,
              breakdown: {
                per_crew: vehicleResult.crews,
                total: vehicleResult.total_annual,
                fuel_excluded_crew_labels: vehicleResult.fuel_excluded_crew_labels,
                notes: [],
              },
            }
          : { total: Math.round(vehicle_lease), basis: 'override' as const },
        total_direct_cost: Math.round(total_direct_cost),
      },
      indirect_cost: { corporate_overhead: Math.round(corporate_overhead) },
      total_cost: Math.round(total_cost),
      margin: {
        target_pct: inputs.target_gross_margin_pct,
        margin_amount: Math.round(margin_amount),
      },
      bid_total: Math.round(bid_total),
      bid_per_property: Math.round(bid_per_property),
      per_service_line: lines,
      monthly_invoice_estimate: Math.round(monthly_invoice_estimate),
      cost_breakdown_pct,
    },
    summary_text: summaryParts.join(' '),
  }
}

// Per-service-line $/sqft breakdown.
//
// For each service category present in the portfolio:
//   - sqft        = sum of SL.serviceable_sqft
//   - visit_sqft  = sum of (SL.sqft × visits_per_year)        [project only]
//   - work_hours  = annual project-crew hours for the line     [project only]
//   - alloc_share = work_hours / total_project_hours
//   - alloc_cost  = bid_total × alloc_share                    [project only]
//   - $/sqft/visit = alloc_cost / visit_sqft                   [project]
//   - $/sqft/year  = (placeholder; recurring not currently in scope of
//                    this bid total — surfaced as null with a note)
function computePerServiceLine(
  properties: Awaited<ReturnType<typeof loadAccountProperties>>,
  offerings: Map<string, { id: string; name: string }> | undefined,
  hoursInputs:
    | {
        project_clean_base_hours: number
        project_clean_hours_per_sqft: number
        upholstery_solo_hours: number
        upholstery_combo_hours_pct: number
        visits_per_year_default: number
      }
    | undefined,
  bid_total: number
): Array<{
  service_line: 'project_clean' | 'upholstery' | 'recurring_janitorial' | 'other'
  label: string
  unit: 'visit' | 'year'
  sl_count: number
  sqft: number
  visit_sqft: number | null
  avg_visits_per_year: number | null
  annual_work_hours: number | null
  allocated_annual_cost: number | null
  rate_per_sqft: number | null
  in_scope: boolean
  note: string | null
}> {
  if (!offerings || !hoursInputs) return []

  type Bucket = {
    label: string
    sqft: number
    visit_sqft: number
    work_hours: number
    sl_count: number
    visit_weight_sum: number // for avg visits
  }
  const buckets: Record<string, Bucket> = {
    project_clean: { label: 'Project Clean', sqft: 0, visit_sqft: 0, work_hours: 0, sl_count: 0, visit_weight_sum: 0 },
    upholstery: { label: 'Upholstery', sqft: 0, visit_sqft: 0, work_hours: 0, sl_count: 0, visit_weight_sum: 0 },
    recurring_janitorial: { label: 'Recurring Janitorial', sqft: 0, visit_sqft: 0, work_hours: 0, sl_count: 0, visit_weight_sum: 0 },
    other: { label: 'Other', sqft: 0, visit_sqft: 0, work_hours: 0, sl_count: 0, visit_weight_sum: 0 },
  }

  for (const p of properties) {
    // Detect combo for project_clean adjustment
    let hasProjectClean = false
    let hasUpholstery = false
    for (const sl of p.service_locations) {
      const off = sl.service_offering_id ? offerings.get(sl.service_offering_id) : null
      const cat = off ? classifyOffering(off.name) : 'other'
      if (cat === 'project_clean') hasProjectClean = true
      if (cat === 'upholstery') hasUpholstery = true
    }
    for (const sl of p.service_locations) {
      const off = sl.service_offering_id ? offerings.get(sl.service_offering_id) : null
      const cat = off ? classifyOffering(off.name) : 'other'
      const bucket = buckets[cat] ?? buckets.other
      const sqft = sl.serviceable_sqft ?? 0
      const visits = sl.visits_per_year_override ?? hoursInputs.visits_per_year_default

      bucket.sl_count += 1
      bucket.sqft += sqft
      if (sqft > 0) bucket.visit_weight_sum += visits

      if (cat === 'project_clean') {
        let hpv =
          hoursInputs.project_clean_base_hours +
          sqft * hoursInputs.project_clean_hours_per_sqft
        if (hasUpholstery) hpv *= 1 + hoursInputs.upholstery_combo_hours_pct
        bucket.work_hours += hpv * visits
        bucket.visit_sqft += sqft * visits
      } else if (cat === 'upholstery') {
        if (!hasProjectClean) {
          bucket.work_hours += hoursInputs.upholstery_solo_hours * visits
        }
        bucket.visit_sqft += sqft * visits
      }
      // recurring_janitorial / other: hours not modeled by bid_pricing
      // today, so we skip work_hours here (still record sqft for
      // visibility).
    }
  }

  const projectHours =
    buckets.project_clean.work_hours + buckets.upholstery.work_hours

  const out: Array<any> = []
  for (const cat of ['project_clean', 'upholstery', 'recurring_janitorial', 'other'] as const) {
    const b = buckets[cat]
    if (b.sl_count === 0) continue
    const inScope = cat === 'project_clean' || cat === 'upholstery'
    const allocShare = inScope && projectHours > 0 ? b.work_hours / projectHours : 0
    const allocCost = inScope ? bid_total * allocShare : null
    const avgVisits = b.sl_count > 0 ? +(b.visit_weight_sum / b.sl_count).toFixed(2) : null
    const unit = cat === 'recurring_janitorial' ? 'year' : 'visit'
    let rate: number | null = null
    if (inScope && allocCost != null) {
      const denom = b.visit_sqft
      rate = denom > 0 ? +(allocCost / denom).toFixed(2) : null
    }
    out.push({
      service_line: cat,
      label: b.label,
      unit,
      sl_count: b.sl_count,
      sqft: Math.round(b.sqft),
      visit_sqft: inScope ? Math.round(b.visit_sqft) : null,
      avg_visits_per_year: avgVisits,
      annual_work_hours: inScope ? Math.round(b.work_hours) : null,
      allocated_annual_cost: allocCost != null ? Math.round(allocCost) : null,
      rate_per_sqft: rate,
      in_scope: inScope,
      note: inScope
        ? null
        : cat === 'recurring_janitorial'
          ? 'Recurring janitorial is not priced by this bid model; bid separately on $/sqft/year.'
          : 'Not classified by the offering rules.',
    })
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────
// Phase 4 — service line bid orchestrator
// ─────────────────────────────────────────────────────────────────────
//
// Loads pricing config from service_line_pricing_config, builds
// per-line property buckets with annual_work_hours, and delegates to
// calculateServiceLineBid. Reuses the cost components already computed
// upstream (branch overhead total, insurance, vehicle, hotels, drive
// miles) so the per-line allocations sum to the same totals.
async function computeServiceLineBid(args: {
  db: any
  accountId: string
  clientId: string
  properties: Awaited<ReturnType<typeof loadAccountProperties>>
  offerings: Map<string, { id: string; name: string }>
  constraints: any
  result: any
  branchOverheadResult: BranchOverheadResult | null
  insuranceResult: InsuranceResult | null
  vehicleResult: VehicleCostResult | null
  hotelsResolved: ResolvedHotelsCost | undefined
  crewStrategyOutputs: any
}): Promise<ServiceLineBidResult | null> {
  const {
    db,
    accountId,
    clientId,
    properties,
    offerings,
    constraints,
    result,
    branchOverheadResult,
    insuranceResult,
    vehicleResult,
    hotelsResolved,
    crewStrategyOutputs,
  } = args

  const { data: configRows } = await db
    .from('service_line_pricing_config')
    .select(
      'service_offering_id, pricing_model, rate_per_sqft_per_visit, rate_per_sqft_per_month, billable_sqft_pct, target_gross_margin_pct_override, is_active'
    )
    .eq('account_id', accountId)
    .eq('client_id', clientId)
    .eq('is_active', true)
  const configs = (configRows ?? []) as Array<{
    service_offering_id: string
    pricing_model: 'per_visit_blended_sqft' | 'per_sqft_monthly'
    rate_per_sqft_per_visit: number | null
    rate_per_sqft_per_month: number | null
    billable_sqft_pct: number
    target_gross_margin_pct_override: number | null
  }>
  if (configs.length === 0) return null

  const accountMargin =
    Number(constraints.target_gross_margin_pct ?? 0.22) * 100 // accounts use 0..1 fractions

  // Pre-compute per-property labor hours via the existing project-hours
  // util. This handles project_clean + upholstery combo math correctly.
  const visitHours = computePropertyVisitHours(properties, offerings, {
    project_clean_base_hours: constraints.project_clean_base_hours,
    project_clean_hours_per_sqft: constraints.project_clean_hours_per_sqft,
    upholstery_solo_hours: constraints.upholstery_solo_hours,
    upholstery_combo_hours_pct: constraints.upholstery_combo_hours_pct,
    visits_per_year_default: constraints.visits_per_year_default ?? 2,
  })
  const annualHoursByPropId = new Map<string, number>()
  for (const v of visitHours) {
    annualHoursByPropId.set(v.property.id, v.annual_hours)
  }

  // Group properties by offering id.
  const propsByOffering: Record<string, ServiceLinePropertyInput[]> = {}
  for (const p of properties) {
    for (const sl of p.service_locations) {
      if (!sl.service_offering_id) continue
      const visitsPerYear =
        (sl as any).visits_per_year_override ??
        (constraints.visits_per_year_default ?? 2)
      const arr = propsByOffering[sl.service_offering_id] ?? []
      arr.push({
        service_location_id: sl.id,
        property_id: p.id,
        serviceable_sqft: Number(sl.serviceable_sqft ?? 0),
        visits_per_year: Number(visitsPerYear),
        // Approximation: divide the property's total annual hours
        // proportionally across its SLs by sqft. Good enough for
        // allocation; per-SL hours would require offering-aware split
        // which the property-hours util doesn't expose today.
        annual_work_hours: annualHoursByPropId.get(p.id) ?? 0,
        is_overnight_property: false,
      })
      propsByOffering[sl.service_offering_id] = arr
    }
  }

  // Resolve target margin per line: override → account default.
  const lineConfigs: ServiceLineConfig[] = configs.map((c) => {
    const off = offerings.get(c.service_offering_id)
    const offName = off?.name ?? '(unknown offering)'
    // Treat upholstery as an addon (parent visit absorbs drive/hotels)
    const isAddon = /upholstery/i.test(offName)
    return {
      service_offering_id: c.service_offering_id,
      offering_name: offName,
      pricing_model: c.pricing_model,
      rate_per_sqft_per_visit: c.rate_per_sqft_per_visit,
      rate_per_sqft_per_month: c.rate_per_sqft_per_month,
      billable_sqft_pct: Number(c.billable_sqft_pct ?? 100),
      target_gross_margin_pct:
        c.target_gross_margin_pct_override != null
          ? Number(c.target_gross_margin_pct_override)
          : accountMargin,
      is_addon: isAddon,
    }
  })

  // Pull totals from the upstream cost components. Drive miles/hotels
  // come from the routing template + overnight calc.
  const sharedCosts = {
    total_branch_overhead_annual: branchOverheadResult
      ? branchOverheadResult.total_annual
      : Number(result.outputs.cost_buildup.branch_overhead?.total ?? 0),
    total_corporate_overhead_annual: Number(
      result.outputs.indirect_cost?.corporate_overhead ?? 0
    ),
    total_drive_miles_per_year:
      // Estimate from crew strategy if we have it (annual miles per crew
      // × crew count); otherwise use the resolved vehicle_fuel / fuel_cost
      // ratio as a proxy.
      Number(crewStrategyOutputs?.options?.[crewStrategyOutputs?.recommended_option]?.estimated_drive_miles ?? 0) ||
      (constraints.fuel_cost_per_mile > 0
        ? Math.round(
            Number(result.outputs.cost_buildup.vehicle_fuel ?? 0) /
              constraints.fuel_cost_per_mile
          )
        : 0),
    total_overnight_cost_annual: Number(hotelsResolved?.value ?? 0),
    total_vehicle_cost_annual: vehicleResult
      ? vehicleResult.total_annual
      : Number(result.outputs.cost_buildup.vehicle_lease ?? 0),
    fuel_cost_per_mile: Number(constraints.fuel_cost_per_mile ?? 0.18),
    hourly_loaded_labor_cost: Number(constraints.hourly_loaded_labor_cost ?? 28),
    crew_size: Number(constraints.crew_size ?? 3),
    supplies_pct_of_labor: Number(constraints.supplies_pct_of_labor ?? 0.04),
  }

  return calculateServiceLineBid({
    service_lines: lineConfigs,
    properties_by_offering: propsByOffering,
    shared_costs: sharedCosts,
    insurance: insuranceResult
      ? {
          method: insuranceResult.applied_method as 'percentage_of_revenue' | 'flat',
          percentage_of_revenue: insuranceResult.applied_percentage,
          flat_amount: insuranceResult.calculated_amount,
          minimum_annual_premium: 0,
        }
      : {
          method: 'flat',
          flat_amount: Number(result.outputs.cost_buildup.insurance?.total ?? 0),
        },
  })
}
