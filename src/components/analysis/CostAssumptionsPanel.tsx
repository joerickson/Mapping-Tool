// Phase 3.5 — Centralized Cost Assumptions panel.
// Collapsible card at the top of the dashboard. Shows every cost assumption
// grouped logically with its current value, the system default, and inline
// edit + reset-to-default. Saves go through PUT /operational-constraints
// which triggers a background synthesis refresh.
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import Button from '../ui/Button'

export interface CostAssumptionsConstraints {
  // Crew Economics
  crew_size: number
  hours_per_day: number
  working_days_per_year: number | null
  hourly_loaded_labor_cost: number
  labor_burden_breakdown: {
    wages: boolean
    payroll_taxes: boolean
    workers_comp: boolean
    benefits: boolean
    training: boolean
  } | null
  // Productivity
  project_clean_base_hours: number
  project_clean_hours_per_sqft: number
  upholstery_solo_hours: number
  upholstery_combo_hours_pct: number
  recurring_productivity_sqft_per_hour: number
  visits_per_year_default: number | null
  // Vehicle & Fuel
  fuel_cost_per_mile: number
  vehicles_per_crew: number
  vehicle_lease_annual_per_crew: number
  drive_speed_mph: number
  max_one_way_drive_minutes: number
  // Surge
  surge_weeks_per_year: number
  surge_crew_count: number
  surge_premium_multiplier: number
  // Branch & Operational
  branch_overhead_annual: number
  hotels_annual: number
  supplies_pct_of_labor: number
  insurance_annual: number
  corporate_overhead_pct: number
  target_gross_margin_pct: number

  system_defaults?: Record<string, number>
}

const PHASE35_DEFAULTS = {
  working_days_per_year: 250,
  visits_per_year_default: 2,
}

const FORMATS: Record<string, (n: number) => string> = {
  hourly_loaded_labor_cost: (n) => `$${n.toFixed(2)}`,
  vehicle_lease_annual_per_crew: (n) => `$${n.toLocaleString()}`,
  branch_overhead_annual: (n) => `$${n.toLocaleString()}`,
  hotels_annual: (n) => `$${n.toLocaleString()}`,
  insurance_annual: (n) => `$${n.toLocaleString()}`,
  fuel_cost_per_mile: (n) => `$${n.toFixed(3)}`,
  supplies_pct_of_labor: (n) => `${(n * 100).toFixed(1)}%`,
  corporate_overhead_pct: (n) => `${(n * 100).toFixed(1)}%`,
  target_gross_margin_pct: (n) => `${(n * 100).toFixed(1)}%`,
  upholstery_combo_hours_pct: (n) => `${Math.round(n * 100)}%`,
  surge_premium_multiplier: (n) => `${n.toFixed(1)}×`,
  recurring_productivity_sqft_per_hour: (n) => `${n.toLocaleString()} sqft/hr`,
  drive_speed_mph: (n) => `${n} mph`,
  max_one_way_drive_minutes: (n) => `${n} min`,
}
const fmt = (key: string, v: number) =>
  FORMATS[key] ? FORMATS[key](v) : v.toLocaleString()

const GROUPS: Array<{
  title: string
  description?: string
  fields: Array<{ key: keyof CostAssumptionsConstraints; label: string }>
}> = [
  {
    title: 'Crew Economics',
    fields: [
      { key: 'crew_size', label: 'Crew size (workers)' },
      { key: 'hours_per_day', label: 'Hours per day' },
      { key: 'working_days_per_year', label: 'Working days per year' },
      { key: 'hourly_loaded_labor_cost', label: 'Hourly loaded labor cost' },
    ],
  },
  {
    title: 'Productivity Rules',
    fields: [
      { key: 'project_clean_base_hours', label: 'Project Clean base hours' },
      { key: 'project_clean_hours_per_sqft', label: 'Project Clean per-sqft (hrs/sqft)' },
      { key: 'upholstery_solo_hours', label: 'Upholstery solo hours' },
      { key: 'upholstery_combo_hours_pct', label: 'Upholstery combo % of Project Clean' },
      { key: 'recurring_productivity_sqft_per_hour', label: 'Recurring janitorial productivity' },
      { key: 'visits_per_year_default', label: 'Visits per year (default)' },
    ],
  },
  {
    title: 'Vehicle & Fuel',
    fields: [
      { key: 'fuel_cost_per_mile', label: 'Fuel cost per mile' },
      { key: 'vehicles_per_crew', label: 'Vehicles per crew' },
      { key: 'vehicle_lease_annual_per_crew', label: 'Vehicle lease per crew per year' },
      { key: 'drive_speed_mph', label: 'Drive speed (highway average)' },
      { key: 'max_one_way_drive_minutes', label: 'Maximum one-way drive' },
    ],
  },
  {
    title: 'Surge Model (Option C)',
    fields: [
      { key: 'surge_weeks_per_year', label: 'Surge weeks per year' },
      { key: 'surge_crew_count', label: 'Surge crew count' },
      { key: 'surge_premium_multiplier', label: 'Surge labor cost multiplier' },
    ],
  },
  {
    title: 'Branch & Operational Costs',
    fields: [
      { key: 'branch_overhead_annual', label: 'Branch overhead per year' },
      { key: 'hotels_annual', label: 'Hotels & overnight stays per year' },
      { key: 'supplies_pct_of_labor', label: 'Supplies (% of labor)' },
      { key: 'insurance_annual', label: 'Insurance per year' },
      { key: 'corporate_overhead_pct', label: 'Corporate overhead (% of direct cost)' },
      { key: 'target_gross_margin_pct', label: 'Target gross margin' },
    ],
  },
]

interface Props {
  accountId: string
  // Optional initial-expand support so module cards can deep-link by group
  highlightGroup?: string | null
  onSaved?: () => void
}

export default function CostAssumptionsPanel({ accountId, highlightGroup, onSaved }: Props) {
  const { getToken } = useAuth()
  const [data, setData] = useState<CostAssumptionsConstraints | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<boolean>(!!highlightGroup)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(
        `/api/accounts/${accountId}/operational-constraints`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as CostAssumptionsConstraints
      setData(json)
    } catch (err: any) {
      setError(err?.message ?? String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  // If a deep-link group changed, expand and scroll into view
  useEffect(() => {
    if (highlightGroup) {
      setOpen(true)
      const id = `cost-group-${slug(highlightGroup)}`
      setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 50)
    }
  }, [highlightGroup])

  const defaults = useMemo(() => {
    const sys = data?.system_defaults ?? {}
    return {
      ...sys,
      working_days_per_year: PHASE35_DEFAULTS.working_days_per_year,
      visits_per_year_default: PHASE35_DEFAULTS.visits_per_year_default,
    } as Record<string, number>
  }, [data?.system_defaults])

  const overrideCount = useMemo(() => {
    if (!data) return 0
    let n = 0
    for (const g of GROUPS) {
      for (const f of g.fields) {
        const cur = data[f.key]
        const def = defaults[f.key as string]
        if (typeof cur === 'number' && typeof def === 'number' && Math.abs(cur - def) > 1e-9) {
          n += 1
        }
      }
    }
    return n
  }, [data, defaults])

  const startEdit = (key: string, currentVal: number) => {
    setEditingKey(key)
    setEditValue(String(currentVal))
  }

  const cancelEdit = () => {
    setEditingKey(null)
    setEditValue('')
  }

  const saveField = async (key: string, newValue: number | null) => {
    if (!data) return
    setSaving(true)
    setToast(null)
    try {
      const token = await getToken()
      // PUT requires the existing branch/exclusion config to be passed back.
      // Pull from the current data; backend treats missing fields as no-op.
      const payload: Record<string, unknown> = {
        [key]: newValue,
        client_id: (data as any).client_id ?? null,
        existing_branches: (data as any).existing_branches ?? [],
        excluded_property_ids: (data as any).excluded_property_ids ?? [],
        excluded_property_reason: (data as any).excluded_property_reason ?? null,
        population_constraint: (data as any).population_constraint ?? undefined,
        utilization_constraint: (data as any).utilization_constraint ?? undefined,
      }
      const res = await fetch(
        `/api/accounts/${accountId}/operational-constraints`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        }
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }
      await refresh()
      setToast(`Updated. Re-running synthesis…`)
      setTimeout(() => setToast(null), 4000)
      onSaved?.()
    } catch (err: any) {
      setError(err?.message ?? String(err))
    } finally {
      setSaving(false)
      setEditingKey(null)
      setEditValue('')
    }
  }

  const resetField = (key: string) => saveField(key, null)

  const commitEdit = () => {
    if (editingKey == null) return
    const trimmed = editValue.trim()
    if (trimmed === '') {
      cancelEdit()
      return
    }
    const n = Number(trimmed)
    if (!Number.isFinite(n)) {
      setError(`"${trimmed}" is not a valid number`)
      return
    }
    saveField(editingKey, n)
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-gray-50"
      >
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-gray-900">Cost Assumptions</div>
          <div className="text-xs text-gray-500 mt-0.5">
            {loading
              ? 'Loading…'
              : error
              ? <span className="text-red-600">Failed: {error}</span>
              : <>
                  {overrideCount} of{' '}
                  {GROUPS.reduce((s, g) => s + g.fields.length, 0)} fields overridden from defaults.{' '}
                  Click to {open ? 'collapse' : 'expand'} and review or edit.
                </>}
          </div>
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && data && (
        <div className="border-t px-5 py-4 space-y-5">
          {toast && (
            <div className="bg-green-50 border border-green-200 text-green-800 text-sm px-3 py-2 rounded">
              {toast}
            </div>
          )}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded">
              {error}
            </div>
          )}

          {GROUPS.map((g) => (
            <section key={g.title} id={`cost-group-${slug(g.title)}`}>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">{g.title}</h4>
              <div className="border rounded-lg divide-y">
                {g.fields.map((f) => {
                  const cur = (data[f.key] as number | null | undefined) ?? defaults[f.key as string]
                  const def = defaults[f.key as string]
                  const overridden =
                    typeof cur === 'number' &&
                    typeof def === 'number' &&
                    Math.abs(cur - def) > 1e-9
                  const isEditing = editingKey === (f.key as string)
                  return (
                    <div
                      key={f.key as string}
                      className="px-3 py-2.5 flex items-center justify-between gap-3 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-gray-800">{f.label}</div>
                        <div className="text-xs text-gray-500">
                          Default: {typeof def === 'number' ? fmt(f.key as string, def) : '—'}
                          {overridden && (
                            <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                              Overridden
                            </span>
                          )}
                        </div>
                      </div>
                      {isEditing ? (
                        <>
                          <input
                            type="number"
                            step="any"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            autoFocus
                            disabled={saving}
                            className="w-32 border border-gray-300 rounded px-2 py-1 text-sm font-mono"
                          />
                          <Button size="sm" onClick={commitEdit} loading={saving}>
                            Save
                          </Button>
                          <Button variant="secondary" size="sm" onClick={cancelEdit} disabled={saving}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <div className="font-mono font-semibold text-gray-900 text-right min-w-[100px]">
                            {typeof cur === 'number' ? fmt(f.key as string, cur) : '—'}
                          </div>
                          <button
                            type="button"
                            onClick={() => typeof cur === 'number' && startEdit(f.key as string, cur)}
                            className="text-xs text-blue-600 hover:underline"
                            disabled={saving}
                          >
                            Edit
                          </button>
                          {overridden && (
                            <button
                              type="button"
                              onClick={() => resetField(f.key as string)}
                              className="text-xs text-gray-500 hover:text-red-600"
                              disabled={saving}
                              title="Reset to system default"
                            >
                              ↻ Reset
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
