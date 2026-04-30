// Phase 3.9 — per-crew vehicle cost calculator. Reads any explicit
// crew_vehicles rows for the (account, client) and falls back to the
// vehicle_config defaults for crews without explicit assignments.
//
// Three ownership types:
//   lease     = (monthly_lease + monthly_maintenance) × 12 + reg + insurance
//   purchase  = (monthly_payment + monthly_maintenance) × 12 + reg + insurance + depreciation
//   personal_vehicle_reimbursement
//             = (annual_miles × rate_per_mile) + (monthly_stipend × 12)
//
// The IRS standard mileage rate already covers gas + depreciation +
// maintenance, so callers should exclude personal-vehicle crews from
// vehicle_fuel allocation (we surface fuel_excluded_crew_labels).
import type { SupabaseClient } from '@supabase/supabase-js'

export type OwnershipType = 'lease' | 'purchase' | 'personal_vehicle_reimbursement'

export interface VehicleConfig {
  default_vehicles_per_crew: number
  default_ownership_type: OwnershipType
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

export interface VehicleCostInput {
  db: SupabaseClient
  account_id: string
  client_id: string
  crew_count: number
  estimated_annual_drive_miles_per_crew: number
  config: VehicleConfig
}

export interface VehicleBreakdown {
  annual_lease_or_payment?: number
  annual_maintenance?: number
  annual_registration?: number
  annual_insurance?: number
  annual_depreciation?: number
  annual_mileage_reimbursement?: number
  annual_stipend?: number
}

export interface CrewVehicleDetail {
  crew_label: string
  vehicles: Array<{
    ownership_type: OwnershipType
    annual_cost: number
    breakdown: VehicleBreakdown
    using_overrides: boolean
  }>
  total_annual: number
}

export interface VehicleCostResult {
  crews: CrewVehicleDetail[]
  total_annual: number
  total_per_crew_average: number
  fuel_excluded_crew_labels: string[]
}

interface CrewVehicleRow {
  crew_label: string
  vehicle_index: number
  ownership_type: OwnershipType
  monthly_lease_override: number | null
  monthly_payment_override: number | null
  monthly_maintenance_override: number | null
  annual_registration_override: number | null
  annual_insurance_override: number | null
  annual_depreciation_override: number | null
  rate_per_mile_override: number | null
  monthly_stipend_override: number | null
}

function calcVehicle(
  ownership: OwnershipType,
  config: VehicleConfig,
  miles: number,
  ov: Partial<CrewVehicleRow> = {}
): { annual_cost: number; breakdown: VehicleBreakdown; overridden: boolean } {
  let annual = 0
  const breakdown: VehicleBreakdown = {}
  let overridden = false

  if (ownership === 'lease') {
    const d = config.ownership_defaults.lease
    const monthlyLease = ov.monthly_lease_override ?? d.monthly_lease
    const monthlyMaint = ov.monthly_maintenance_override ?? d.monthly_maintenance
    const reg = ov.annual_registration_override ?? d.annual_registration
    const ins = ov.annual_insurance_override ?? d.annual_insurance
    breakdown.annual_lease_or_payment = monthlyLease * 12
    breakdown.annual_maintenance = monthlyMaint * 12
    breakdown.annual_registration = reg
    breakdown.annual_insurance = ins
    annual =
      breakdown.annual_lease_or_payment +
      breakdown.annual_maintenance +
      reg +
      ins
    overridden =
      ov.monthly_lease_override != null ||
      ov.monthly_maintenance_override != null ||
      ov.annual_registration_override != null ||
      ov.annual_insurance_override != null
  } else if (ownership === 'purchase') {
    const d = config.ownership_defaults.purchase
    const monthlyPmt = ov.monthly_payment_override ?? d.monthly_payment
    const monthlyMaint = ov.monthly_maintenance_override ?? d.monthly_maintenance
    const reg = ov.annual_registration_override ?? d.annual_registration
    const ins = ov.annual_insurance_override ?? d.annual_insurance
    const dep = ov.annual_depreciation_override ?? d.annual_depreciation_estimate
    breakdown.annual_lease_or_payment = monthlyPmt * 12
    breakdown.annual_maintenance = monthlyMaint * 12
    breakdown.annual_registration = reg
    breakdown.annual_insurance = ins
    breakdown.annual_depreciation = dep
    annual =
      breakdown.annual_lease_or_payment +
      breakdown.annual_maintenance +
      reg +
      ins +
      dep
    overridden =
      ov.monthly_payment_override != null ||
      ov.monthly_maintenance_override != null ||
      ov.annual_registration_override != null ||
      ov.annual_insurance_override != null ||
      ov.annual_depreciation_override != null
  } else {
    const d = config.ownership_defaults.personal_vehicle_reimbursement
    const rate = ov.rate_per_mile_override ?? d.rate_per_mile
    const stipend = ov.monthly_stipend_override ?? d.monthly_stipend
    breakdown.annual_mileage_reimbursement = Math.round(miles * rate)
    breakdown.annual_stipend = stipend * 12
    annual = breakdown.annual_mileage_reimbursement + breakdown.annual_stipend
    overridden =
      ov.rate_per_mile_override != null || ov.monthly_stipend_override != null
  }

  return {
    annual_cost: Math.round(annual),
    breakdown,
    overridden,
  }
}

export async function calculateVehicleCosts(
  input: VehicleCostInput
): Promise<VehicleCostResult> {
  // Pull explicit crew_vehicles rows; group by crew_label.
  const { data: rowsData } = await input.db
    .from('crew_vehicles')
    .select('*')
    .eq('account_id', input.account_id)
    .eq('client_id', input.client_id)
  const rows = (rowsData ?? []) as CrewVehicleRow[]
  const explicitByCrew = new Map<string, CrewVehicleRow[]>()
  for (const r of rows) {
    const arr = explicitByCrew.get(r.crew_label) ?? []
    arr.push(r)
    explicitByCrew.set(r.crew_label, arr)
  }

  // Build crew labels: prefer explicit ones, then synthesize defaults
  // ("Crew 1"…"Crew N") to fill out to crew_count.
  const explicitLabels = Array.from(explicitByCrew.keys()).sort()
  const defaultLabels: string[] = []
  for (let i = 1; i <= input.crew_count; i++) {
    const label = `Crew ${i}`
    if (!explicitByCrew.has(label)) defaultLabels.push(label)
  }
  const allLabels = [...explicitLabels, ...defaultLabels.slice(0, Math.max(0, input.crew_count - explicitLabels.length))]
  // If still short of crew_count (unique explicit labels exceeded
  // crew_count), keep all explicit; if longer, truncate.
  while (allLabels.length < input.crew_count && allLabels.length < explicitLabels.length + input.crew_count) {
    allLabels.push(`Crew ${allLabels.length + 1}`)
  }

  const crews: CrewVehicleDetail[] = []
  const fuelExcluded: string[] = []
  let total = 0

  for (const label of allLabels) {
    const explicit = explicitByCrew.get(label)
    const vehicles: CrewVehicleDetail['vehicles'] = []
    let crewTotal = 0
    let crewIsPersonal = true

    if (explicit && explicit.length > 0) {
      for (const row of explicit) {
        const r = calcVehicle(
          row.ownership_type,
          input.config,
          input.estimated_annual_drive_miles_per_crew,
          row
        )
        vehicles.push({
          ownership_type: row.ownership_type,
          annual_cost: r.annual_cost,
          breakdown: r.breakdown,
          using_overrides: r.overridden,
        })
        crewTotal += r.annual_cost
        if (row.ownership_type !== 'personal_vehicle_reimbursement') {
          crewIsPersonal = false
        }
      }
    } else {
      // Synthesize from defaults: 1 vehicle of default_ownership_type.
      const n = Math.max(1, input.config.default_vehicles_per_crew)
      const ownership = input.config.default_ownership_type
      for (let i = 0; i < n; i++) {
        const r = calcVehicle(
          ownership,
          input.config,
          input.estimated_annual_drive_miles_per_crew
        )
        vehicles.push({
          ownership_type: ownership,
          annual_cost: r.annual_cost,
          breakdown: r.breakdown,
          using_overrides: false,
        })
        crewTotal += r.annual_cost
      }
      if (ownership !== 'personal_vehicle_reimbursement') crewIsPersonal = false
    }

    if (crewIsPersonal && vehicles.length > 0) fuelExcluded.push(label)

    crews.push({
      crew_label: label,
      vehicles,
      total_annual: crewTotal,
    })
    total += crewTotal
  }

  return {
    crews,
    total_annual: Math.round(total),
    total_per_crew_average:
      crews.length > 0 ? Math.round(total / crews.length) : 0,
    fuel_excluded_crew_labels: fuelExcluded,
  }
}
