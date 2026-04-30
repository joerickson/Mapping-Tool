// Phase 3.9 — surfaces the new structured cost configs (branch
// overhead, insurance, vehicle costs) on the Cost Assumptions panel.
//
// Minimal v1 scope: shows the configured defaults with inline editing
// for the most common knobs and the calculated totals fetched from
// the latest bid pricing breakdown. Per-branch / per-crew override
// modals are intentionally deferred — the structured config itself
// is the meaningful change and writes through PUT
// /operational-constraints just like every other field on the panel.
import { useCallback, useEffect, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import Button from '../ui/Button'
import { Badge } from '../ui/Badge'
import { Input } from '../ui/Input'
import type { CostAssumptionsConstraints } from './CostAssumptionsPanel'

interface BranchOverheadConfig {
  main_defaults: BranchTypeDefaults
  satellite_defaults: BranchTypeDefaults
}
interface BranchTypeDefaults {
  rent_monthly: number
  utilities_monthly: number
  manager_salary_annual: number
  manager_burden_pct: number
  other_operational_monthly: number
}
interface InsuranceConfig {
  calculation_method: 'percentage_of_revenue' | 'flat'
  percentage_of_revenue?: number
  minimum_annual_premium?: number
  flat_amount?: number
}
interface VehicleConfig {
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

const TYPE_FIELDS: Array<{
  key: keyof BranchTypeDefaults
  label: string
  format: (n: number) => string
}> = [
  { key: 'rent_monthly', label: 'Rent (monthly)', format: (n) => `$${n.toLocaleString()}` },
  { key: 'utilities_monthly', label: 'Utilities (monthly)', format: (n) => `$${n.toLocaleString()}` },
  { key: 'manager_salary_annual', label: 'Manager salary (annual)', format: (n) => `$${n.toLocaleString()}` },
  { key: 'manager_burden_pct', label: 'Manager burden %', format: (n) => `${n}%` },
  { key: 'other_operational_monthly', label: 'Other operational (monthly)', format: (n) => `$${n.toLocaleString()}` },
]

interface Props {
  accountId: string
  clientId: string
  constraintsRow: CostAssumptionsConstraints & {
    branch_overhead_config?: BranchOverheadConfig
    insurance_config?: InsuranceConfig
    vehicle_config?: VehicleConfig
    branch_overhead_annual_override?: number | null
    insurance_annual_override?: number | null
    vehicle_lease_annual_per_crew_override?: number | null
  }
  onSaved: () => void
}

export default function StructuredCostsSection({
  accountId,
  clientId,
  constraintsRow,
  onSaved,
}: Props) {
  const { getToken } = useAuth()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState<string>('')
  const [breakdown, setBreakdown] = useState<{
    branch_overhead?: { total: number; main_count: number; satellite_count: number }
    insurance?: { total: number; breakdown_text: string }
    vehicle_costs?: { total: number; per_crew_count: number; fuel_excluded_count: number }
  } | null>(null)

  // Pull latest bid_pricing analysis to surface the calculated totals.
  const refreshBreakdown = useCallback(async () => {
    try {
      const token = await getToken()
      const res = await fetch(
        `/api/analyses/account/${accountId}/clients/${clientId}/latest`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!res.ok) return
      const rows = (await res.json()) as Array<{ module_key: string; outputs: any; status: string }>
      const bid = rows.find((r) => r.module_key === 'bid_pricing_structure' && r.status === 'completed')
      if (!bid?.outputs?.cost_buildup) return
      const cb = bid.outputs.cost_buildup
      setBreakdown({
        branch_overhead:
          cb.branch_overhead && typeof cb.branch_overhead === 'object'
            ? {
                total: Number(cb.branch_overhead.total ?? 0),
                main_count: cb.branch_overhead.breakdown?.main_count ?? 0,
                satellite_count: cb.branch_overhead.breakdown?.satellite_count ?? 0,
              }
            : undefined,
        insurance:
          cb.insurance && typeof cb.insurance === 'object'
            ? {
                total: Number(cb.insurance.total ?? 0),
                breakdown_text: cb.insurance.breakdown?.breakdown_text ?? '',
              }
            : undefined,
        vehicle_costs:
          cb.vehicle_costs && typeof cb.vehicle_costs === 'object'
            ? {
                total: Number(cb.vehicle_costs.total ?? 0),
                per_crew_count: cb.vehicle_costs.breakdown?.per_crew?.length ?? 0,
                fuel_excluded_count:
                  cb.vehicle_costs.breakdown?.fuel_excluded_crew_labels?.length ?? 0,
              }
            : undefined,
      })
    } catch {
      // Silent — the section still renders the configured defaults.
    }
  }, [accountId, clientId, getToken])

  useEffect(() => {
    refreshBreakdown()
  }, [refreshBreakdown])

  const branchConfig = constraintsRow.branch_overhead_config ?? {
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
  const insuranceConfig = constraintsRow.insurance_config ?? {
    calculation_method: 'percentage_of_revenue' as const,
    percentage_of_revenue: 1.5,
    minimum_annual_premium: 5000,
  }
  const vehicleConfig = constraintsRow.vehicle_config ?? {
    default_vehicles_per_crew: 1,
    default_ownership_type: 'lease' as const,
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

  const save = async (body: Record<string, unknown>) => {
    setSaving(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(
        `/api/accounts/${accountId}/clients/${clientId}/operational-constraints`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        }
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as any).error ?? `Save failed: ${res.status}`)
      }
      onSaved()
      await refreshBreakdown()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const saveBranchField = (
    section: 'main_defaults' | 'satellite_defaults',
    field: keyof BranchTypeDefaults,
    raw: string
  ) => {
    const n = parseFloat(raw)
    if (!Number.isFinite(n)) {
      setEditingKey(null)
      return
    }
    const next: BranchOverheadConfig = {
      ...branchConfig,
      [section]: { ...branchConfig[section], [field]: n },
    }
    save({ branch_overhead_config: next })
    setEditingKey(null)
  }

  const saveInsurance = (next: InsuranceConfig) => save({ insurance_config: next })
  const saveVehicleConfig = (next: VehicleConfig) => save({ vehicle_config: next })

  const renderTypeBlock = (
    section: 'main_defaults' | 'satellite_defaults',
    title: string
  ) => {
    const def = branchConfig[section]
    const total =
      def.rent_monthly * 12 +
      def.utilities_monthly * 12 +
      def.manager_salary_annual * (1 + def.manager_burden_pct / 100) +
      def.other_operational_monthly * 12
    return (
      <div className="rounded-md border border-border bg-surface-subtle/40 p-3">
        <p className="text-[10px] uppercase tracking-wider text-fg-subtle font-semibold mb-2">
          {title}
        </p>
        <ul className="space-y-1">
          {TYPE_FIELDS.map((f) => {
            const k = `${section}:${String(f.key)}`
            const editing = editingKey === k
            return (
              <li
                key={String(f.key)}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span className="text-fg-muted">{f.label}</span>
                {editing ? (
                  <span className="flex items-center gap-1">
                    <Input
                      type="number"
                      step="any"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="w-24 h-7 text-xs"
                      autoFocus
                    />
                    <Button
                      size="sm"
                      onClick={() => saveBranchField(section, f.key, editValue)}
                      disabled={saving}
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingKey(null)}>
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingKey(k)
                      setEditValue(String(def[f.key]))
                    }}
                    className="text-fg hover:text-accent font-tabular"
                  >
                    {f.format(def[f.key])}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
        <p className="mt-2 pt-2 border-t border-border/40 text-xs text-fg-muted">
          Calculated annual:{' '}
          <span className="font-tabular text-fg">${Math.round(total).toLocaleString()}</span>
        </p>
      </div>
    )
  }

  return (
    <section className="space-y-3 mt-6">
      <header>
        <h3 className="text-sm font-semibold text-fg">
          Structured costs (Phase 3.9)
        </h3>
        <p className="text-xs text-fg-muted mt-0.5">
          Replaces the flat constants for branch overhead, insurance, and vehicle costs with per-component calculations. Edit a field to update the default; the bid pricing total recalculates on next module run.
        </p>
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </header>

      {/* Branch overhead */}
      <div className="rounded-md border border-border bg-surface p-4 space-y-3">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <p className="text-xs uppercase tracking-wider text-fg-subtle font-semibold">
            Branch overhead
          </p>
          {breakdown?.branch_overhead && (
            <p className="text-sm text-fg">
              <span className="font-mono font-semibold tabular-nums">
                ${breakdown.branch_overhead.total.toLocaleString()}
              </span>
              <span className="text-xs text-fg-muted ml-1">
                /yr ·{' '}
                <Badge variant="outline" className="text-[10px]">
                  {breakdown.branch_overhead.main_count} main
                </Badge>{' '}
                <Badge variant="outline" className="text-[10px]">
                  {breakdown.branch_overhead.satellite_count} satellite
                </Badge>
              </span>
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {renderTypeBlock('main_defaults', 'Main branch defaults')}
          {renderTypeBlock('satellite_defaults', 'Satellite branch defaults')}
        </div>
        {constraintsRow.branch_overhead_annual_override != null && (
          <p className="text-xs text-warning">
            Manually overridden to ${Number(constraintsRow.branch_overhead_annual_override).toLocaleString()}/yr.
            <button
              type="button"
              onClick={() => save({ branch_overhead_annual_override: null })}
              className="ml-2 inline-flex items-center gap-0.5 text-fg-muted hover:text-fg"
            >
              <RotateCcw className="h-3 w-3" /> Clear override
            </button>
          </p>
        )}
      </div>

      {/* Insurance */}
      <div className="rounded-md border border-border bg-surface p-4 space-y-2">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <p className="text-xs uppercase tracking-wider text-fg-subtle font-semibold">
            Insurance
          </p>
          {breakdown?.insurance && (
            <p className="text-sm text-fg">
              <span className="font-mono font-semibold tabular-nums">
                ${breakdown.insurance.total.toLocaleString()}
              </span>
              <span className="text-xs text-fg-muted ml-1">/yr</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-fg-muted">Method:</span>
          <button
            type="button"
            onClick={() =>
              saveInsurance({
                ...insuranceConfig,
                calculation_method: 'percentage_of_revenue',
              })
            }
            className={
              'px-2 py-0.5 rounded ' +
              (insuranceConfig.calculation_method === 'percentage_of_revenue'
                ? 'bg-accent text-white'
                : 'border border-border text-fg-muted hover:bg-surface-subtle')
            }
          >
            % of revenue
          </button>
          <button
            type="button"
            onClick={() =>
              saveInsurance({ ...insuranceConfig, calculation_method: 'flat' })
            }
            className={
              'px-2 py-0.5 rounded ' +
              (insuranceConfig.calculation_method === 'flat'
                ? 'bg-accent text-white'
                : 'border border-border text-fg-muted hover:bg-surface-subtle')
            }
          >
            Flat
          </button>
        </div>
        {insuranceConfig.calculation_method === 'percentage_of_revenue' ? (
          <div className="grid grid-cols-2 gap-3 text-xs">
            <label className="flex items-center gap-2">
              <span className="text-fg-muted">Pct of revenue</span>
              <Input
                type="number"
                step="0.1"
                defaultValue={insuranceConfig.percentage_of_revenue ?? 1.5}
                onBlur={(e) =>
                  saveInsurance({
                    ...insuranceConfig,
                    percentage_of_revenue: parseFloat(e.target.value) || 0,
                  })
                }
                className="h-7 text-xs w-20"
              />
              <span>%</span>
            </label>
            <label className="flex items-center gap-2">
              <span className="text-fg-muted">Minimum</span>
              <Input
                type="number"
                step="100"
                defaultValue={insuranceConfig.minimum_annual_premium ?? 5000}
                onBlur={(e) =>
                  saveInsurance({
                    ...insuranceConfig,
                    minimum_annual_premium: parseFloat(e.target.value) || 0,
                  })
                }
                className="h-7 text-xs w-28"
              />
            </label>
          </div>
        ) : (
          <label className="flex items-center gap-2 text-xs">
            <span className="text-fg-muted">Flat amount</span>
            <Input
              type="number"
              step="100"
              defaultValue={insuranceConfig.flat_amount ?? 18000}
              onBlur={(e) =>
                saveInsurance({
                  ...insuranceConfig,
                  flat_amount: parseFloat(e.target.value) || 0,
                })
              }
              className="h-7 text-xs w-32"
            />
            <span className="text-fg-muted">/yr</span>
          </label>
        )}
        {breakdown?.insurance?.breakdown_text && (
          <p className="text-xs text-fg-subtle italic">
            {breakdown.insurance.breakdown_text}
          </p>
        )}
      </div>

      {/* Vehicle costs */}
      <div className="rounded-md border border-border bg-surface p-4 space-y-2">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <p className="text-xs uppercase tracking-wider text-fg-subtle font-semibold">
            Vehicle costs
          </p>
          {breakdown?.vehicle_costs && (
            <p className="text-sm text-fg">
              <span className="font-mono font-semibold tabular-nums">
                ${breakdown.vehicle_costs.total.toLocaleString()}
              </span>
              <span className="text-xs text-fg-muted ml-1">
                /yr · {breakdown.vehicle_costs.per_crew_count} crews
                {breakdown.vehicle_costs.fuel_excluded_count > 0 && (
                  <>
                    {' · '}
                    {breakdown.vehicle_costs.fuel_excluded_count} on personal vehicle
                  </>
                )}
              </span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-fg-muted">Default ownership:</span>
          {(['lease', 'purchase', 'personal_vehicle_reimbursement'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() =>
                saveVehicleConfig({ ...vehicleConfig, default_ownership_type: t })
              }
              className={
                'px-2 py-0.5 rounded ' +
                (vehicleConfig.default_ownership_type === t
                  ? 'bg-accent text-white'
                  : 'border border-border text-fg-muted hover:bg-surface-subtle')
              }
            >
              {t === 'lease' ? 'Lease' : t === 'purchase' ? 'Purchase' : 'Personal'}
            </button>
          ))}
        </div>
        <p className="text-xs text-fg-subtle italic">
          Per-vehicle defaults and per-crew assignments are configured in the structured config; the bid pricing total uses the calculated sum.
        </p>
      </div>

      {saving && (
        <p className="text-xs text-fg-muted flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Saving…
        </p>
      )}
    </section>
  )
}
