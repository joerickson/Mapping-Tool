// POST /api/analyses/[accountId]/bid-pricing-structure
// Builds a complete bid pricing model: cost buildup → corporate overhead →
// margin → final bid. Pulls prior modules' outputs as defaults so the user
// can iterate by re-running just one upstream module.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import {
  loadAccountProperties,
  createAnalysisRecord,
  completeAnalysisRecord,
  failAnalysisRecord,
  fetchLatestCompletedAnalysis,
} from '../../../_lib/analysis/account-data.js'
import {
  loadConstraints,
  applyExclusions,
  requireSelectedBranches,
  NO_SELECTION_ERROR,
} from '../../../_lib/analysis/operational-constraints.js'

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
  const body = (req.body ?? {}) as Partial<BidInputs>
  const db = createAdminClient()
  const constraints = await loadConstraints(db, accountId)

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
  }

  let analysisId: string
  try {
    analysisId = await createAnalysisRecord(db, {
      account_id: accountId,
      client_id: inputs.client_id ?? null,
      module_key: 'bid_pricing_structure',
      inputs: inputs as unknown as Record<string, unknown>,
      created_by: ctx.userId ?? null,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message ?? 'Failed to create analysis record' })
  }

  try {
    const allProperties = await loadAccountProperties(
      db,
      accountId,
      inputs.client_id ?? null
    )
    const properties = applyExclusions(allProperties, constraints.excluded_property_ids)

    if (inputs.branch_count == null) {
      inputs.branch_count = constraints.selected_k ?? sel.branches.length
    }

    const crewStrategy = await fetchLatestCompletedAnalysis(db, accountId, 'crew_strategy')
    const branchOpt = await fetchLatestCompletedAnalysis(db, accountId, 'branch_optimization')
    const workforce = await fetchLatestCompletedAnalysis(db, accountId, 'workforce_sizing')

    const result = computeBidPricing(
      properties,
      inputs,
      crewStrategy?.outputs,
      branchOpt?.outputs,
      workforce?.outputs
    )

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

export function computeBidPricing(
  properties: Awaited<ReturnType<typeof loadAccountProperties>>,
  inputs: BidInputs,
  crewStrategyOutputs: any,
  branchOptOutputs: any,
  workforceOutputs: any
) {
  let resolvedLabor = inputs.total_annual_labor_cost
  let resolvedVehicleFuel = inputs.total_annual_vehicle_cost
  let resolvedCrewCount = inputs.crew_count
  let recommendedOption: string | null = null

  if (crewStrategyOutputs) {
    recommendedOption = crewStrategyOutputs.recommended_option
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
  const vehicle_fuel = resolvedVehicleFuel
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
  const bid_per_sqft = totalSqft > 0 ? bid_total / totalSqft : 0
  const monthly_invoice_estimate = bid_total / 12

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
  if (recommendedOption) {
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
      },
      cost_buildup: {
        direct_labor: Math.round(direct_labor),
        vehicle_fuel: Math.round(vehicle_fuel),
        vehicle_lease: Math.round(vehicle_lease),
        hotels: Math.round(hotels),
        supplies: Math.round(supplies),
        branch_overhead: Math.round(branch_overhead),
        insurance: Math.round(insurance),
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
      bid_per_sqft: +bid_per_sqft.toFixed(2),
      monthly_invoice_estimate: Math.round(monthly_invoice_estimate),
      cost_breakdown_pct,
    },
    summary_text: summaryParts.join(' '),
  }
}
