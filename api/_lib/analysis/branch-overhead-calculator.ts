// Phase 3.9 — calculate per-branch annual overhead based on type
// (main vs satellite), each with its own defaults, and per-branch
// override layers. Pure function — no I/O.
//
// Math per branch:
//   rent_annual          = rent_monthly × 12
//   utilities_annual     = utilities_monthly × 12
//   manager_loaded_annual = manager_salary_annual × (1 + manager_burden_pct/100)
//   other_operational_annual = other_operational_monthly × 12
//   total_annual         = sum of the above

export type BranchType = 'main' | 'satellite'

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

// Per-branch overrides keyed by branch name. branch_type override here
// wins over the branch's own branch_type field so users can re-classify
// without editing the selected_branches jsonb directly.
export type BranchOverrides = Record<
  string,
  Partial<BranchTypeDefaults> & { branch_type?: BranchType }
>

export interface BranchOverheadInput {
  branches: Array<{
    name: string
    branch_type?: BranchType
    lat?: number
    lng?: number
  }>
  config: BranchOverheadConfig
  per_branch_overrides?: BranchOverrides
}

export interface BranchOverheadDetail {
  branch_name: string
  branch_type: BranchType
  rent_annual: number
  utilities_annual: number
  manager_loaded_annual: number
  other_operational_annual: number
  total_annual: number
  using_overrides: boolean
  override_fields: string[]
}

export interface BranchOverheadResult {
  branches: BranchOverheadDetail[]
  total_annual: number
  main_count: number
  satellite_count: number
}

const NUMERIC_FIELDS: Array<keyof BranchTypeDefaults> = [
  'rent_monthly',
  'utilities_monthly',
  'manager_salary_annual',
  'manager_burden_pct',
  'other_operational_monthly',
]

export function calculateBranchOverhead(
  input: BranchOverheadInput
): BranchOverheadResult {
  const overrides = input.per_branch_overrides ?? {}
  const out: BranchOverheadDetail[] = []
  let mainCount = 0
  let satCount = 0

  for (const branch of input.branches) {
    const ov = overrides[branch.name] ?? {}
    const effectiveType: BranchType =
      ov.branch_type ?? branch.branch_type ?? 'main'
    if (effectiveType === 'main') mainCount++
    else satCount++

    const baseDefaults =
      effectiveType === 'main'
        ? input.config.main_defaults
        : input.config.satellite_defaults

    const overriddenFields: string[] = []
    const merged: BranchTypeDefaults = { ...baseDefaults }
    for (const f of NUMERIC_FIELDS) {
      const v = ov[f]
      if (typeof v === 'number' && Number.isFinite(v) && v !== baseDefaults[f]) {
        merged[f] = v
        overriddenFields.push(f)
      }
    }

    const rent_annual = merged.rent_monthly * 12
    const utilities_annual = merged.utilities_monthly * 12
    const manager_loaded_annual =
      merged.manager_salary_annual * (1 + merged.manager_burden_pct / 100)
    const other_operational_annual = merged.other_operational_monthly * 12
    const total_annual =
      rent_annual + utilities_annual + manager_loaded_annual + other_operational_annual

    out.push({
      branch_name: branch.name,
      branch_type: effectiveType,
      rent_annual: Math.round(rent_annual),
      utilities_annual: Math.round(utilities_annual),
      manager_loaded_annual: Math.round(manager_loaded_annual),
      other_operational_annual: Math.round(other_operational_annual),
      total_annual: Math.round(total_annual),
      using_overrides: overriddenFields.length > 0 || ov.branch_type != null,
      override_fields: overriddenFields,
    })
  }

  const total = out.reduce((s, b) => s + b.total_annual, 0)
  return {
    branches: out,
    total_annual: total,
    main_count: mainCount,
    satellite_count: satCount,
  }
}
