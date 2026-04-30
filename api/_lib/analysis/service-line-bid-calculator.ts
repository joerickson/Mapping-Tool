// Phase 4 — service line bid calculator.
//
// Replaces the single-rollup bid pricing model with per-service-line
// outputs. Revenue per line is set by RATE × BILLABLE SQFT (not
// allocated top-down from a fixed bid total). Direct costs are
// allocated by actual usage (labor hours, drive-miles share); shared
// overhead (branch overhead, insurance, corporate) is allocated by
// each line's revenue share.
//
// Pure function on the inputs the caller assembles (which includes
// data from operational-constraints, service_locations, the routing
// template if present, etc.). No I/O.

export type PricingModel = 'per_visit_blended_sqft' | 'per_sqft_monthly'

export interface ServiceLinePropertyInput {
  service_location_id: string
  property_id: string
  serviceable_sqft: number
  visits_per_year: number
  // Annual hours of project-crew work this property contributes to this
  // service line. Pre-computed by the caller using
  // computePropertyVisitHours and addon-attachment rules.
  annual_work_hours: number
  // For overnight allocation: marked true if this property is in a
  // remote cluster that triggered hotel cost.
  is_overnight_property?: boolean
}

export interface ServiceLineConfig {
  service_offering_id: string
  offering_name: string
  pricing_model: PricingModel
  rate_per_sqft_per_visit?: number | null
  rate_per_sqft_per_month?: number | null
  billable_sqft_pct: number
  target_gross_margin_pct: number
  // For addon offerings: parent attribution. Addon visits don't add
  // drive miles, vehicle ownership, or hotels — those are absorbed by
  // the parent. Set true for addon-style services (e.g. Upholstery
  // attached to Project Clean).
  is_addon?: boolean
}

export interface ServiceLineBidInput {
  service_lines: ServiceLineConfig[]
  properties_by_offering: Record<string, ServiceLinePropertyInput[]>
  shared_costs: {
    total_branch_overhead_annual: number
    total_corporate_overhead_annual: number
    total_drive_miles_per_year: number
    total_overnight_cost_annual: number
    total_vehicle_cost_annual: number
    fuel_cost_per_mile: number
    hourly_loaded_labor_cost: number
    crew_size: number
    supplies_pct_of_labor: number
  }
  // Insurance config — applied two-pass (computed against post-revenue
  // total, then re-allocated by revenue share). Pass 1 uses 0; pass 2
  // uses the final calculated number.
  insurance: {
    method: 'percentage_of_revenue' | 'flat'
    percentage_of_revenue?: number
    minimum_annual_premium?: number
    flat_amount?: number
  }
}

export interface ServiceLineDirectCosts {
  labor: number
  fuel: number
  vehicle: number
  hotels: number
  supplies: number
  subtotal: number
}

export interface ServiceLineAllocatedCosts {
  branch_overhead_share: number
  insurance_share: number
  corporate_overhead_share: number
  subtotal: number
}

export interface ServiceLineDetail {
  offering_id: string
  offering_name: string
  pricing_model: PricingModel
  rate: number
  rate_label: string
  billable_sqft_pct: number
  property_count: number
  total_sqft_raw: number
  total_sqft_billable: number
  total_visits_per_year: number
  total_work_hours: number
  annual_revenue: number
  monthly_revenue: number
  revenue_per_visit_average: number | null
  direct_costs: ServiceLineDirectCosts
  allocated_costs: ServiceLineAllocatedCosts
  total_cost: number
  target_gross_margin_pct: number
  actual_gross_margin_dollars: number
  actual_gross_margin_pct: number
  margin_below_target: boolean
  warnings: string[]
}

export interface ServiceLineBidResult {
  service_lines: ServiceLineDetail[]
  summary: {
    total_annual_revenue: number
    total_annual_cost: number
    total_gross_profit: number
    weighted_average_margin_pct: number
    service_line_count: number
    properties_total: number
  }
  allocations_audit: {
    revenue_share_by_line: Record<string, number>
    insurance_passes: number
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function rateOf(line: ServiceLineConfig): number {
  return line.pricing_model === 'per_visit_blended_sqft'
    ? Number(line.rate_per_sqft_per_visit ?? 0)
    : Number(line.rate_per_sqft_per_month ?? 0)
}

function rateLabel(line: ServiceLineConfig): string {
  return line.pricing_model === 'per_visit_blended_sqft'
    ? `$${rateOf(line).toFixed(2)}/sqft/visit`
    : `$${rateOf(line).toFixed(2)}/sqft/month`
}

// Compute revenue + property/visit/hour totals + warnings.
function computeRevenue(
  line: ServiceLineConfig,
  props: ServiceLinePropertyInput[]
): {
  total_sqft_raw: number
  total_sqft_billable: number
  total_visits_per_year: number
  total_work_hours: number
  annual_revenue: number
  warnings: string[]
} {
  const warnings: string[] = []
  const rate = rateOf(line)
  if (rate <= 0) {
    warnings.push(`No rate configured for "${line.offering_name}" — revenue is $0`)
  }
  if (line.billable_sqft_pct === 0) {
    warnings.push(
      `Billable sqft % is 0 for "${line.offering_name}" — revenue is $0 but cost still computed`
    )
  }
  const billPct = line.billable_sqft_pct / 100
  let total_sqft_raw = 0
  let total_sqft_billable = 0
  let total_visits_per_year = 0
  let total_work_hours = 0
  let annual_revenue = 0

  for (const p of props) {
    total_sqft_raw += p.serviceable_sqft
    total_visits_per_year += p.visits_per_year
    total_work_hours += p.annual_work_hours
    const billable = p.serviceable_sqft * billPct
    total_sqft_billable += billable
    if (line.pricing_model === 'per_visit_blended_sqft') {
      annual_revenue += billable * rate * p.visits_per_year
    } else {
      // per_sqft_monthly: monthly × 12.
      annual_revenue += billable * rate * 12
    }
  }
  return {
    total_sqft_raw,
    total_sqft_billable,
    total_visits_per_year,
    total_work_hours,
    annual_revenue,
    warnings,
  }
}

export function calculateServiceLineBid(
  input: ServiceLineBidInput
): ServiceLineBidResult {
  // Step 1 — revenue + work hours per line.
  type Bucket = {
    line: ServiceLineConfig
    props: ServiceLinePropertyInput[]
    rev: ReturnType<typeof computeRevenue>
  }
  const buckets: Bucket[] = []
  let totalWorkHoursAllLines = 0
  let totalWorkHoursRoutedLines = 0
  let totalWorkHoursAddonLines = 0
  for (const line of input.service_lines) {
    const props = input.properties_by_offering[line.service_offering_id] ?? []
    const rev = computeRevenue(line, props)
    buckets.push({ line, props, rev })
    totalWorkHoursAllLines += rev.total_work_hours
    if (line.is_addon) {
      totalWorkHoursAddonLines += rev.total_work_hours
    } else {
      totalWorkHoursRoutedLines += rev.total_work_hours
    }
  }

  // Step 2 — direct costs per line.
  // Labor: actual hours × crew_size × hourly_loaded_labor_cost.
  // Fuel: drive-miles share among non-addon lines weighted by labor.
  // Vehicle: vehicle ownership cost split among non-addon lines weighted by labor.
  // Hotels: hotel total split among non-addon lines that have at least
  //         one overnight property, weighted by their overnight hours.
  // Supplies: percentage of labor, per line.
  const sc = input.shared_costs
  const directByOffering = new Map<string, ServiceLineDirectCosts>()

  for (const b of buckets) {
    const labor = b.rev.total_work_hours * sc.crew_size * sc.hourly_loaded_labor_cost
    let fuel = 0
    let vehicle = 0
    let hotels = 0
    if (!b.line.is_addon) {
      const routedShare =
        totalWorkHoursRoutedLines > 0
          ? b.rev.total_work_hours / totalWorkHoursRoutedLines
          : 0
      // fuel via drive-miles allocation (drive miles are total for all
      // routed work; share by labor hours within routed lines).
      fuel = sc.total_drive_miles_per_year * sc.fuel_cost_per_mile * routedShare
      vehicle = sc.total_vehicle_cost_annual * routedShare
      // Hotels: split among routed lines proportional to overnight hours.
      const overnightHoursThisLine = b.props
        .filter((p) => p.is_overnight_property)
        .reduce((s, p) => s + p.annual_work_hours, 0)
      const totalOvernightHours = buckets
        .filter((bb) => !bb.line.is_addon)
        .reduce(
          (s, bb) =>
            s +
            bb.props
              .filter((p) => p.is_overnight_property)
              .reduce((s2, p) => s2 + p.annual_work_hours, 0),
          0
        )
      hotels =
        totalOvernightHours > 0
          ? sc.total_overnight_cost_annual * (overnightHoursThisLine / totalOvernightHours)
          : 0
    }
    const supplies = labor * sc.supplies_pct_of_labor
    directByOffering.set(b.line.service_offering_id, {
      labor: round2(labor),
      fuel: round2(fuel),
      vehicle: round2(vehicle),
      hotels: round2(hotels),
      supplies: round2(supplies),
      subtotal: round2(labor + fuel + vehicle + hotels + supplies),
    })
  }

  // Step 3 — allocate shared overhead by revenue share.
  // Insurance is two-pass: Pass 1 uses revenue ignoring insurance;
  // Pass 2 recomputes insurance against pass-1 revenue and re-allocates.
  const totalRevenue = buckets.reduce((s, b) => s + b.rev.annual_revenue, 0)

  // Pass 1: insurance = 0. Compute final allocation in one shot.
  let insurancePasses = 0
  let insuranceTotal = 0
  if (input.insurance.method === 'flat') {
    insuranceTotal = Number(input.insurance.flat_amount ?? 0)
    insurancePasses = 1
  } else {
    // percentage_of_revenue. Pass 1 uses pre-cost-allocation revenue
    // (which is revenue at the user's rates — already what we have).
    const pct = Number(input.insurance.percentage_of_revenue ?? 0)
    const min = Number(input.insurance.minimum_annual_premium ?? 0)
    const computed = totalRevenue * (pct / 100)
    insuranceTotal = computed < min ? min : computed
    insurancePasses = 1
    // (No pass 2 needed — revenue is rate-driven, not derived from
    // cost + margin, so insurance is a deterministic function of the
    // already-final revenue total.)
  }

  // Step 4 — assemble per-line details.
  const allocAudit: Record<string, number> = {}
  const lines: ServiceLineDetail[] = []
  for (const b of buckets) {
    const direct = directByOffering.get(b.line.service_offering_id)!
    const revenueShare = totalRevenue > 0 ? b.rev.annual_revenue / totalRevenue : 0
    allocAudit[b.line.offering_name] = round2(revenueShare * 1000) / 1000

    const branchOverheadShare = sc.total_branch_overhead_annual * revenueShare
    const insuranceShare = insuranceTotal * revenueShare
    const corporateShare = sc.total_corporate_overhead_annual * revenueShare
    const allocated: ServiceLineAllocatedCosts = {
      branch_overhead_share: round2(branchOverheadShare),
      insurance_share: round2(insuranceShare),
      corporate_overhead_share: round2(corporateShare),
      subtotal: round2(branchOverheadShare + insuranceShare + corporateShare),
    }

    const total_cost = round2(direct.subtotal + allocated.subtotal)
    const grossProfit = b.rev.annual_revenue - total_cost
    const grossMarginPct =
      b.rev.annual_revenue > 0 ? (grossProfit / b.rev.annual_revenue) * 100 : 0

    const propertyCount = b.props.length
    const monthlyRevenue = b.rev.annual_revenue / 12
    const revenuePerVisitAverage =
      b.line.pricing_model === 'per_visit_blended_sqft' && b.rev.total_visits_per_year > 0
        ? b.rev.annual_revenue / b.rev.total_visits_per_year
        : null

    lines.push({
      offering_id: b.line.service_offering_id,
      offering_name: b.line.offering_name,
      pricing_model: b.line.pricing_model,
      rate: rateOf(b.line),
      rate_label: rateLabel(b.line),
      billable_sqft_pct: b.line.billable_sqft_pct,
      property_count: propertyCount,
      total_sqft_raw: Math.round(b.rev.total_sqft_raw),
      total_sqft_billable: Math.round(b.rev.total_sqft_billable),
      total_visits_per_year: b.rev.total_visits_per_year,
      total_work_hours: Math.round(b.rev.total_work_hours),
      annual_revenue: round2(b.rev.annual_revenue),
      monthly_revenue: round2(monthlyRevenue),
      revenue_per_visit_average:
        revenuePerVisitAverage != null ? round2(revenuePerVisitAverage) : null,
      direct_costs: direct,
      allocated_costs: allocated,
      total_cost,
      target_gross_margin_pct: b.line.target_gross_margin_pct,
      actual_gross_margin_dollars: round2(grossProfit),
      actual_gross_margin_pct: round2(grossMarginPct),
      margin_below_target: grossMarginPct < b.line.target_gross_margin_pct - 0.5,
      warnings: b.rev.warnings,
    })
  }

  const totalCost = lines.reduce((s, l) => s + l.total_cost, 0)
  const totalProfit = totalRevenue - totalCost
  const weightedMarginPct =
    totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0

  return {
    service_lines: lines,
    summary: {
      total_annual_revenue: round2(totalRevenue),
      total_annual_cost: round2(totalCost),
      total_gross_profit: round2(totalProfit),
      weighted_average_margin_pct: round2(weightedMarginPct),
      service_line_count: lines.length,
      properties_total: lines.reduce((s, l) => s + l.property_count, 0),
    },
    allocations_audit: {
      revenue_share_by_line: allocAudit,
      insurance_passes: insurancePasses,
    },
  }
}
