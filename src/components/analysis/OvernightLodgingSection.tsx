// Phase 3.7 — "Overnight & Lodging" subsection on the Cost Assumptions
// panel. Replaces the legacy flat hotels_annual row.
//
// Reads/writes hotel_cost_config (jsonb) + hotels_annual_override (numeric)
// through the same /operational-constraints PUT that the rest of the panel
// uses, then re-fetches the calculated overnight breakdown for the live
// total preview.
import { useEffect, useState, useCallback } from 'react'
import { ExternalLink, RotateCcw } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import Button from '../ui/Button'
import { Badge } from '../ui/Badge'
import { Input } from '../ui/Input'
import OvernightBreakdownDrawer from './OvernightBreakdownDrawer'
import type {
  CostAssumptionsConstraints,
  HotelCostConfig,
} from './CostAssumptionsPanel'

// Mirror the resolved-cost shape returned by /overnight-breakdown.
interface BreakdownResponse {
  result: {
    total_overnight_nights_per_year: number
    total_hotel_cost: number
    total_per_diem_cost: number
    total_overnight_cost: number
    trips: any[]
    properties_requiring_overnight: number
    day_trip_property_count: number
  }
  resolved: {
    value: number
    basis: 'override' | 'calculated' | 'flat_fallback'
    calculated_value: number
  }
}

const FIELDS: Array<{
  key: keyof HotelCostConfig
  label: string
  format: (n: number) => string
  inputMode: 'currency' | 'hours' | 'number'
}> = [
  { key: 'cost_per_night', label: 'Hotel cost per night', format: (n) => `$${n}`, inputMode: 'currency' },
  { key: 'overnight_trigger_one_way_hours', label: 'Overnight trigger (one-way drive)', format: (n) => `${n} hr`, inputMode: 'hours' },
  { key: 'max_work_hours_per_crew_day', label: 'Max work hours per crew day', format: (n) => `${n} hr`, inputMode: 'hours' },
  { key: 'per_diem_per_night', label: 'Per diem per crew member per night', format: (n) => `$${n}`, inputMode: 'currency' },
]

const DEFAULTS: Record<keyof HotelCostConfig, number | boolean> = {
  cost_per_night: 120,
  overnight_trigger_one_way_hours: 3,
  max_work_hours_per_crew_day: 8,
  buffer_hours_per_day: 2,
  per_diem_per_night: 50,
  include_per_diem: true,
}

interface Props {
  accountId: string
  clientId: string
  config: HotelCostConfig
  override: number | null
  constraintsRow: CostAssumptionsConstraints
  onSaved: () => void
}

export default function OvernightLodgingSection({
  accountId,
  clientId,
  config,
  override,
  constraintsRow,
  onSaved,
}: Props) {
  const { getToken } = useAuth()
  const [breakdown, setBreakdown] = useState<BreakdownResponse | null>(null)
  const [loadingBreakdown, setLoadingBreakdown] = useState(false)
  const [breakdownError, setBreakdownError] = useState<string | null>(null)
  const [editingKey, setEditingKey] = useState<keyof HotelCostConfig | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [overrideEditing, setOverrideEditing] = useState(false)
  const [overrideDraft, setOverrideDraft] = useState('')

  const loadBreakdown = useCallback(async () => {
    setLoadingBreakdown(true)
    setBreakdownError(null)
    try {
      const token = await getToken()
      const res = await fetch(
        `/api/analyses/account/${accountId}/clients/${clientId}/overnight-breakdown`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (res.status === 400) {
        const body = await res.json().catch(() => ({}))
        if (body.code === 'BRANCHES_NOT_SELECTED') {
          setBreakdown(null)
          setBreakdownError('Select branches first to calculate overnight costs.')
          return
        }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setBreakdown(await res.json())
    } catch (err) {
      setBreakdownError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingBreakdown(false)
    }
  }, [accountId, clientId, getToken])

  useEffect(() => {
    loadBreakdown()
  }, [loadBreakdown, config, override])

  async function saveConstraint(patch: Record<string, unknown>) {
    setSaving(true)
    try {
      const token = await getToken()
      // /operational-constraints expects the full row shape — pass through
      // the existing fields we already loaded so unrelated values don't
      // get nulled out by the upsert.
      const payload: Record<string, unknown> = {
        client_id: (constraintsRow as any).client_id ?? null,
        existing_branches: (constraintsRow as any).existing_branches ?? [],
        excluded_property_ids: (constraintsRow as any).excluded_property_ids ?? [],
        excluded_property_reason: (constraintsRow as any).excluded_property_reason ?? null,
        population_constraint: (constraintsRow as any).population_constraint ?? undefined,
        utilization_constraint: (constraintsRow as any).utilization_constraint ?? undefined,
        ...patch,
      }
      const res = await fetch(
        `/api/accounts/${accountId}/clients/${clientId}/operational-constraints`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        }
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      onSaved()
    } finally {
      setSaving(false)
      setEditingKey(null)
      setEditValue('')
      setOverrideEditing(false)
    }
  }

  function commitFieldEdit() {
    if (editingKey == null) return
    const n = Number(editValue.trim())
    if (!Number.isFinite(n)) return
    saveConstraint({ hotel_cost_config: { ...config, [editingKey]: n } })
  }

  function toggleIncludePerDiem(next: boolean) {
    saveConstraint({ hotel_cost_config: { ...config, include_per_diem: next } })
  }

  function startOverrideEdit() {
    setOverrideEditing(true)
    setOverrideDraft(override == null ? '' : String(override))
  }

  function commitOverride() {
    const trimmed = overrideDraft.trim()
    if (trimmed === '') {
      saveConstraint({ hotels_annual_override: null })
      return
    }
    const n = Number(trimmed)
    if (!Number.isFinite(n)) return
    saveConstraint({ hotels_annual_override: n })
  }

  function clearOverride() {
    saveConstraint({ hotels_annual_override: null })
  }

  return (
    <section className="space-y-2" id="cost-group-overnight-and-lodging">
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
        Overnight & lodging
      </h4>
      <p className="text-xs text-fg-subtle">
        Calculated from selected branches + property coverage. Phase 3.7 replaces the flat $35K assumption.
      </p>

      <ul className="divide-y divide-border rounded-md border border-border bg-surface">
        {FIELDS.map((f) => {
          const cur = (config[f.key] as number | undefined) ?? (DEFAULTS[f.key] as number)
          const def = DEFAULTS[f.key] as number
          const overridden = Math.abs(cur - def) > 1e-9
          const isEditing = editingKey === f.key
          return (
            <li key={f.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-fg">{f.label}</p>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-muted">
                  <span>Default: <span className="font-tabular">{f.format(def)}</span></span>
                  {overridden && <Badge variant="accent">Overridden</Badge>}
                </div>
              </div>
              {isEditing ? (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="any"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    autoFocus
                    disabled={saving}
                    className="w-32 font-mono"
                  />
                  <Button size="sm" onClick={commitFieldEdit} loading={saving}>Save</Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditingKey(null)} disabled={saving}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <p className="min-w-[100px] text-right font-mono font-semibold tabular-nums text-fg">
                    {f.format(cur)}
                  </p>
                  <button
                    type="button"
                    onClick={() => { setEditingKey(f.key); setEditValue(String(cur)) }}
                    className="rounded-sm text-xs text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                    disabled={saving}
                  >
                    Edit
                  </button>
                  {overridden && (
                    <button
                      type="button"
                      onClick={() => saveConstraint({ hotel_cost_config: { ...config, [f.key]: def } })}
                      className="inline-flex items-center gap-1 rounded-sm text-xs text-fg-muted hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                      disabled={saving}
                      title="Reset to default"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Reset
                    </button>
                  )}
                </div>
              )}
            </li>
          )
        })}

        {/* Per-diem toggle */}
        <li className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-fg">Include per diem in cost?</p>
            <p className="mt-0.5 text-xs text-fg-muted">
              Multiplies per-diem rate × crew size × nights into the rolled-up overnight cost.
            </p>
          </div>
          <label className="inline-flex items-center cursor-pointer gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={config.include_per_diem ?? true}
              onChange={(e) => toggleIncludePerDiem(e.target.checked)}
              className="rounded border-border accent-accent"
              disabled={saving}
            />
            {config.include_per_diem ? 'Yes' : 'No'}
          </label>
        </li>
      </ul>

      {/* Calculated total preview */}
      <div className="rounded-md border border-border bg-surface-subtle px-4 py-3">
        {loadingBreakdown ? (
          <p className="text-sm text-fg-muted">Calculating overnight cost…</p>
        ) : breakdownError ? (
          <p className="text-sm text-danger">{breakdownError}</p>
        ) : breakdown ? (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-xs uppercase tracking-wider text-fg-subtle">
                {override != null
                  ? 'Calculated annual overnight cost (overridden)'
                  : 'Calculated annual overnight cost'}
              </p>
              <p className="font-mono text-xl font-semibold tabular-nums text-fg">
                ${(override ?? breakdown.result.total_overnight_cost).toLocaleString()}
              </p>
            </div>
            {override != null && (
              <p className="mt-1 text-xs text-fg-muted">
                Calculated would have been:{' '}
                <span className="font-tabular">
                  ${breakdown.result.total_overnight_cost.toLocaleString()}
                </span>
              </p>
            )}
            <p className="mt-1 text-xs text-fg-muted">
              Based on{' '}
              <span className="font-tabular">{breakdown.result.trips.length}</span> cluster
              {breakdown.result.trips.length === 1 ? '' : 's'} ·{' '}
              <span className="font-tabular">
                {breakdown.result.total_overnight_nights_per_year}
              </span>{' '}
              total nights ·{' '}
              <span className="font-tabular">
                {breakdown.result.properties_requiring_overnight}
              </span>{' '}
              propert{breakdown.result.properties_requiring_overnight === 1 ? 'y' : 'ies'}
              {breakdown.result.day_trip_property_count > 0 && (
                <>
                  {' '}(+ <span className="font-tabular">{breakdown.result.day_trip_property_count}</span>{' '}
                  day-trip propert
                  {breakdown.result.day_trip_property_count === 1 ? 'y' : 'ies'})
                </>
              )}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setDrawerOpen(true)}
                disabled={breakdown.result.trips.length === 0}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                View detailed breakdown
              </Button>
              {override == null ? (
                <Button size="sm" variant="ghost" onClick={startOverrideEdit}>
                  Override with flat value
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={clearOverride} loading={saving}>
                  Use calculated value instead
                </Button>
              )}
            </div>
            {overrideEditing && (
              <div className="mt-3 flex items-center gap-2">
                <Input
                  type="number"
                  step="any"
                  value={overrideDraft}
                  onChange={(e) => setOverrideDraft(e.target.value)}
                  placeholder="Flat annual cost (e.g. 35000)"
                  autoFocus
                  disabled={saving}
                  className="w-48 font-mono"
                />
                <Button size="sm" onClick={commitOverride} loading={saving}>Save override</Button>
                <Button size="sm" variant="ghost" onClick={() => setOverrideEditing(false)} disabled={saving}>
                  Cancel
                </Button>
              </div>
            )}
          </>
        ) : null}
      </div>

      <OvernightBreakdownDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        accountId={accountId}
        clientId={clientId}
      />
    </section>
  )
}
