// Phase 3.9 — insurance as a % of revenue (with minimum) or flat.
// Pure function — no I/O.

export type InsuranceMethod = 'percentage_of_revenue' | 'flat'

export interface InsuranceConfig {
  calculation_method: InsuranceMethod
  percentage_of_revenue?: number
  minimum_annual_premium?: number
  flat_amount?: number
}

export interface InsuranceInput {
  config: InsuranceConfig
  estimated_annual_revenue: number
}

export interface InsuranceResult {
  calculated_amount: number
  applied_method: InsuranceMethod
  basis_amount: number
  applied_percentage: number
  hit_minimum: boolean
  breakdown_text: string
}

export function calculateInsurance(input: InsuranceInput): InsuranceResult {
  const c = input.config
  if (c.calculation_method === 'flat') {
    const amt = Number(c.flat_amount ?? 0)
    return {
      calculated_amount: Math.round(amt),
      applied_method: 'flat',
      basis_amount: 0,
      applied_percentage: 0,
      hit_minimum: false,
      breakdown_text: `Flat amount: $${Math.round(amt).toLocaleString()}/yr`,
    }
  }
  // Percentage-of-revenue path
  const pct = Number(c.percentage_of_revenue ?? 0)
  const minimum = Number(c.minimum_annual_premium ?? 0)
  const revenue = Math.max(0, Number(input.estimated_annual_revenue) || 0)
  const computed = revenue * (pct / 100)
  const final = computed < minimum ? minimum : computed
  const hitMin = computed < minimum
  return {
    calculated_amount: Math.round(final),
    applied_method: 'percentage_of_revenue',
    basis_amount: Math.round(revenue),
    applied_percentage: pct,
    hit_minimum: hitMin,
    breakdown_text: hitMin
      ? `${pct}% of $${Math.round(revenue).toLocaleString()} = $${Math.round(computed).toLocaleString()} → bumped to $${Math.round(minimum).toLocaleString()} minimum`
      : `${pct}% of $${Math.round(revenue).toLocaleString()} estimated revenue = $${Math.round(computed).toLocaleString()}`,
  }
}
