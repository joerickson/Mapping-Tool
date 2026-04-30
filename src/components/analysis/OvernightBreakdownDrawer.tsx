// Overnight breakdown drawer — opens from the Cost Assumptions panel and
// shows cluster-by-cluster detail (which properties go on which trips,
// how many nights, annual cost). Built fresh on design tokens rather than
// reusing SlideOver because we need a wider panel + tabular data layout.
import { useEffect, useState } from 'react'
import { Loader2, RotateCcw, X } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { Badge } from '../ui/Badge'
import Button from '../ui/Button'
import { Input } from '../ui/Input'
import { cn } from '../../lib/cn'

interface Trip {
  branch_name: string
  cluster_id: string
  cluster_centroid: { lat: number; lng: number }
  drive_hours_one_way: number
  total_work_hours_per_visit: number
  work_days_per_trip: number
  nights_per_trip: number
  trips_per_year: number
  annual_nights: number
  annual_hotel_cost: number
  annual_per_diem_cost: number
  annual_total_cost: number
  properties_in_cluster: Array<{
    property_id: string
    address: string | null
    hours_per_visit: number
    visits_per_year: number
  }>
}

interface BreakdownData {
  result: {
    total_overnight_nights_per_year: number
    total_hotel_cost: number
    total_per_diem_cost: number
    total_overnight_cost: number
    trips: Trip[]
    properties_requiring_overnight: number
    day_trip_property_count: number
    avg_drive_hours_to_overnight_property: number
  }
  resolved: {
    value: number
    basis: 'override' | 'calculated' | 'flat_fallback'
    calculated_value: number
  }
}

interface Props {
  open: boolean
  onClose: () => void
  accountId: string
  clientId: string
  // Optional: when set, shows an override input + save/clear so the
  // user can write hotels_annual_override without leaving the drawer.
  // Defaults to true; pass `false` for read-only consumers.
  allowOverride?: boolean
  // Called after a successful override save so the parent can refresh
  // its data (e.g. re-run bid pricing).
  onOverrideSaved?: () => void
}

export default function OvernightBreakdownDrawer({
  open,
  onClose,
  accountId,
  clientId,
  allowOverride = true,
  onOverrideSaved,
}: Props) {
  const { getToken } = useAuth()
  const [data, setData] = useState<BreakdownData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [overrideDraft, setOverrideDraft] = useState('')
  const [overrideEditing, setOverrideEditing] = useState(false)
  const [savingOverride, setSavingOverride] = useState(false)
  const [overrideError, setOverrideError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const token = await getToken()
        const res = await fetch(
          `/api/analyses/account/${accountId}/clients/${clientId}/overnight-breakdown`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        if (!cancelled) setData(await res.json())
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [open, accountId, clientId, getToken])

  // Hydrate the override draft whenever fresh data loads so the input
  // shows the current override (or blank if none).
  useEffect(() => {
    if (!data) return
    if (data.resolved.basis === 'override') {
      setOverrideDraft(String(data.resolved.value))
    } else {
      setOverrideDraft('')
    }
    setOverrideEditing(false)
    setOverrideError(null)
  }, [data])

  const refresh = async () => {
    const token = await getToken()
    const res = await fetch(
      `/api/analyses/account/${accountId}/clients/${clientId}/overnight-breakdown`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (res.ok) setData(await res.json())
  }

  const saveOverride = async (value: number | null) => {
    setSavingOverride(true)
    setOverrideError(null)
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
          body: JSON.stringify({ hotels_annual_override: value }),
        }
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as any).error ?? `Save failed: ${res.status}`)
      }
      await refresh()
      onOverrideSaved?.()
    } catch (err) {
      setOverrideError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingOverride(false)
    }
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-fg/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={cn(
          'fixed right-0 top-0 bottom-0 z-50 w-full max-w-2xl bg-surface-elevated shadow-2xl',
          'border-l border-border flex flex-col'
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-fg">
              Overnight breakdown
            </h2>
            <p className="text-xs text-fg-muted mt-0.5">
              Per-cluster detail of overnight trips driving the calculated annual cost.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-fg-muted hover:text-fg transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {loading && <p className="text-sm text-fg-muted">Loading…</p>}
          {error && <p className="text-sm text-danger">{error}</p>}
          {data && (
            <>
              <SummaryStrip
                data={data}
                allowOverride={allowOverride}
                editing={overrideEditing}
                draft={overrideDraft}
                onDraftChange={setOverrideDraft}
                onStartEdit={() => setOverrideEditing(true)}
                onCancel={() => {
                  setOverrideEditing(false)
                  setOverrideError(null)
                  if (data.resolved.basis === 'override') {
                    setOverrideDraft(String(data.resolved.value))
                  } else {
                    setOverrideDraft('')
                  }
                }}
                onSave={async () => {
                  const n = parseFloat(overrideDraft)
                  await saveOverride(Number.isFinite(n) ? n : null)
                  setOverrideEditing(false)
                }}
                onClear={async () => {
                  await saveOverride(null)
                }}
                saving={savingOverride}
                error={overrideError}
              />
              {data.result.trips.length === 0 ? (
                <div className="rounded-md border border-border bg-surface-subtle px-4 py-6 text-sm text-fg-muted text-center">
                  No overnight stays required — all properties are within{' '}
                  the trigger threshold of their nearest branch.
                </div>
              ) : (
                <ul className="space-y-4">
                  {data.result.trips.map((trip) => (
                    <li
                      key={trip.cluster_id}
                      className="rounded-md border border-border bg-surface p-4"
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="space-y-0.5 min-w-0">
                          <p className="text-sm font-semibold text-fg">
                            {trip.cluster_id}
                          </p>
                          <p className="text-xs text-fg-muted">
                            from <span className="text-fg">{trip.branch_name}</span> ·{' '}
                            <span className="font-tabular">{trip.drive_hours_one_way}</span> hr one-way
                          </p>
                        </div>
                        <Badge variant="accent">
                          ${trip.annual_total_cost.toLocaleString()}/yr
                        </Badge>
                      </div>

                      <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <Stat label="Properties" value={trip.properties_in_cluster.length} />
                        <Stat label="Work hrs/visit" value={trip.total_work_hours_per_visit} />
                        <Stat label="Work days/trip" value={trip.work_days_per_trip} />
                        <Stat label="Nights/trip" value={trip.nights_per_trip} />
                        <Stat label="Trips/year" value={trip.trips_per_year} />
                        <Stat label="Annual nights" value={trip.annual_nights} />
                        <Stat
                          label="Hotel"
                          value={`$${trip.annual_hotel_cost.toLocaleString()}`}
                        />
                        <Stat
                          label="Per diem"
                          value={`$${trip.annual_per_diem_cost.toLocaleString()}`}
                        />
                      </dl>

                      <details className="mt-3 group">
                        <summary className="cursor-pointer text-xs text-accent hover:underline">
                          {trip.properties_in_cluster.length} propert
                          {trip.properties_in_cluster.length === 1 ? 'y' : 'ies'} in cluster
                        </summary>
                        <ul className="mt-2 divide-y divide-border rounded-md border border-border bg-surface-subtle">
                          {trip.properties_in_cluster.map((p) => (
                            <li
                              key={p.property_id}
                              className="px-3 py-2 text-xs flex items-center justify-between gap-2"
                            >
                              <span className="text-fg truncate">
                                {p.address ?? p.property_id.slice(0, 8)}
                              </span>
                              <span className="text-fg-muted whitespace-nowrap font-tabular">
                                {p.hours_per_visit}h × {p.visits_per_year}/yr
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

function SummaryStrip({
  data,
  allowOverride,
  editing,
  draft,
  onDraftChange,
  onStartEdit,
  onCancel,
  onSave,
  onClear,
  saving,
  error,
}: {
  data: BreakdownData
  allowOverride: boolean
  editing: boolean
  draft: string
  onDraftChange: (v: string) => void
  onStartEdit: () => void
  onCancel: () => void
  onSave: () => void | Promise<void>
  onClear: () => void | Promise<void>
  saving: boolean
  error: string | null
}) {
  const isOverride = data.resolved.basis === 'override'
  return (
    <div className="rounded-md border border-border bg-surface-subtle px-4 py-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="text-xs uppercase tracking-wider text-fg-subtle">
          {isOverride ? 'Annual cost (override)' : 'Annual cost (calculated)'}
        </p>
        <p className="font-mono text-2xl font-semibold tabular-nums text-fg">
          ${data.resolved.value.toLocaleString()}
        </p>
      </div>
      {isOverride && (
        <p className="mt-1 text-xs text-fg-muted">
          Calculated would have been:{' '}
          <span className="font-tabular">
            ${data.resolved.calculated_value.toLocaleString()}
          </span>
        </p>
      )}
      <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <Stat label="Hotel total" value={`$${data.result.total_hotel_cost.toLocaleString()}`} />
        <Stat label="Per diem total" value={`$${data.result.total_per_diem_cost.toLocaleString()}`} />
        <Stat label="Total nights" value={data.result.total_overnight_nights_per_year} />
        <Stat label="Clusters" value={data.result.trips.length} />
        <Stat label="Overnight properties" value={data.result.properties_requiring_overnight} />
        <Stat label="Day-trip properties" value={data.result.day_trip_property_count} />
        <Stat
          label="Avg drive (overnight)"
          value={`${data.result.avg_drive_hours_to_overnight_property} hr`}
        />
      </dl>

      {allowOverride && (
        <div className="mt-3 pt-3 border-t border-border space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-fg-subtle font-semibold">
            Override
          </p>
          {!editing ? (
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-xs text-fg-muted flex-1">
                {isOverride
                  ? `Manually overridden to $${data.resolved.value.toLocaleString()}/yr.`
                  : 'No override set — bid pricing uses the calculated total.'}
              </p>
              <Button size="sm" variant="ghost" onClick={onStartEdit}>
                {isOverride ? 'Edit' : 'Set override'}
              </Button>
              {isOverride && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onClear}
                  disabled={saving}
                  title="Clear override and use the calculated total"
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Clear
                </Button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-fg-muted text-sm">$</span>
              <Input
                type="number"
                step="100"
                value={draft}
                onChange={(e) => onDraftChange(e.target.value)}
                className="max-w-[180px]"
                autoFocus
              />
              <Button size="sm" onClick={onSave} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Saving…
                  </>
                ) : (
                  'Save'
                )}
              </Button>
              <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
                Cancel
              </Button>
            </div>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-fg-subtle">{label}</dt>
      <dd className="font-mono font-medium tabular-nums text-fg">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </dd>
    </div>
  )
}
