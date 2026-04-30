// Overnight breakdown drawer — opens from the Cost Assumptions panel and
// shows cluster-by-cluster detail (which properties go on which trips,
// how many nights, annual cost). Phase 4.1 adds borderline/override/skip
// badges, the calculation explainer string, and a per-cluster override
// editor modal.
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Ban, Loader2, Pencil, RotateCcw, Settings2, X } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { Badge } from '../ui/Badge'
import Button from '../ui/Button'
import { Input, FormField, Textarea } from '../ui/Input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog'
import { cn } from '../../lib/cn'

interface Trip {
  branch_name: string
  cluster_id: string
  cluster_label: string
  cluster_centroid: { lat: number; lng: number }
  drive_hours_one_way: number
  drive_distance_miles_one_way: number
  total_work_hours_per_visit: number
  work_days_per_trip: number
  nights_per_trip_calculated: number
  trips_per_year_calculated: number
  cost_per_night_default: number
  per_diem_per_night_default: number
  nights_per_trip: number
  trips_per_year: number
  cost_per_night_used: number
  per_diem_per_night_used: number
  annual_nights: number
  annual_hotel_cost: number
  annual_per_diem_cost: number
  annual_total_cost: number
  is_borderline: boolean
  borderline_reason: string | null
  has_overrides: boolean
  override_fields: string[]
  is_skipped: boolean
  skip_reason: string | null
  calculation_text: string
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
    cluster_count: number
    cluster_count_with_overrides: number
    cluster_count_skipped: number
    cluster_count_borderline: number
    stale_override_cluster_ids: string[]
  }
  resolved: {
    value: number
    basis: 'override' | 'calculated' | 'flat_fallback'
    calculated_value: number
  }
  cluster_override_meta?: Record<
    string,
    {
      cluster_label: string
      override_reason: string | null
      overridden_by: string | null
      overridden_at: string
    }
  >
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
  const [editingClusterId, setEditingClusterId] = useState<string | null>(null)

  const editingTrip = useMemo(() => {
    if (!data || !editingClusterId) return null
    return data.result.trips.find((t) => t.cluster_id === editingClusterId) ?? null
  }, [data, editingClusterId])

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
              {data.result.stale_override_cluster_ids.length > 0 && (
                <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
                  ⚠ {data.result.stale_override_cluster_ids.length} override
                  {data.result.stale_override_cluster_ids.length === 1 ? ' is' : 's are'} stale
                  (cluster contents changed). Open the cluster to clear or re-apply.
                </div>
              )}
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
                      className={cn(
                        'rounded-md border bg-surface p-4',
                        trip.is_skipped
                          ? 'border-fg-subtle/30 opacity-80'
                          : trip.is_borderline
                            ? 'border-warning/30'
                            : trip.has_overrides
                              ? 'border-accent/30'
                              : 'border-border'
                      )}
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-fg">
                              {trip.cluster_label}
                            </p>
                            {trip.is_skipped && (
                              <Badge variant="outline" className="text-[10px]">
                                <Ban className="h-3 w-3 mr-0.5" />
                                Skipped
                              </Badge>
                            )}
                            {trip.is_borderline && (
                              <Badge variant="outline" className="text-[10px] text-warning border-warning/40">
                                <AlertTriangle className="h-3 w-3 mr-0.5" />
                                Borderline
                              </Badge>
                            )}
                            {trip.has_overrides && (
                              <Badge variant="outline" className="text-[10px] text-accent border-accent/40">
                                <Settings2 className="h-3 w-3 mr-0.5" />
                                Overridden
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-fg-muted">
                            from <span className="text-fg">{trip.branch_name}</span> ·{' '}
                            <span className="font-tabular">{trip.drive_hours_one_way}</span> hr one-way ·{' '}
                            <span className="font-tabular">{trip.drive_distance_miles_one_way}</span> mi
                          </p>
                          {trip.is_borderline && trip.borderline_reason && (
                            <p className="text-[11px] text-warning italic mt-0.5">
                              {trip.borderline_reason}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Badge variant="accent">
                            ${trip.annual_total_cost.toLocaleString()}/yr
                          </Badge>
                          <button
                            type="button"
                            onClick={() => setEditingClusterId(trip.cluster_id)}
                            className="text-fg-subtle hover:text-accent inline-flex items-center gap-1 text-xs"
                          >
                            <Pencil className="h-3 w-3" />
                            Edit
                          </button>
                        </div>
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

                      <p className="mt-2 text-[11px] text-fg-subtle font-tabular leading-relaxed">
                        {trip.calculation_text}
                      </p>

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

      {editingTrip && (
        <ClusterOverrideModal
          trip={editingTrip}
          accountId={accountId}
          clientId={clientId}
          getToken={getToken}
          onClose={() => setEditingClusterId(null)}
          onSaved={async () => {
            await refresh()
            onOverrideSaved?.()
            setEditingClusterId(null)
          }}
        />
      )}
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
      {(data.result.cluster_count_borderline > 0 ||
        data.result.cluster_count_with_overrides > 0 ||
        data.result.cluster_count_skipped > 0) && (
        <p className="mt-2 text-[11px] text-fg-muted flex flex-wrap items-center gap-x-3">
          {data.result.cluster_count_borderline > 0 && (
            <span className="inline-flex items-center gap-1 text-warning">
              <AlertTriangle className="h-3 w-3" />
              {data.result.cluster_count_borderline} borderline
            </span>
          )}
          {data.result.cluster_count_with_overrides > 0 && (
            <span className="inline-flex items-center gap-1 text-accent">
              <Settings2 className="h-3 w-3" />
              {data.result.cluster_count_with_overrides} override
              {data.result.cluster_count_with_overrides === 1 ? '' : 's'} applied
            </span>
          )}
          {data.result.cluster_count_skipped > 0 && (
            <span className="inline-flex items-center gap-1">
              <Ban className="h-3 w-3" />
              {data.result.cluster_count_skipped} skipped
            </span>
          )}
        </p>
      )}

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

// Per-cluster override editor. Renders a preview of the resulting
// annual cost as the user edits, so the "what does this change" math
// is visible before save. Skip mode disables the rate fields and
// requires a reason.
function ClusterOverrideModal({
  trip,
  accountId,
  clientId,
  getToken,
  onClose,
  onSaved,
}: {
  trip: Trip
  accountId: string
  clientId: string
  getToken: () => Promise<string | null>
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const initialNights =
    trip.nights_per_trip !== trip.nights_per_trip_calculated
      ? String(trip.nights_per_trip)
      : ''
  const initialTrips =
    trip.trips_per_year !== trip.trips_per_year_calculated
      ? String(trip.trips_per_year)
      : ''
  const initialCost =
    trip.cost_per_night_used !== trip.cost_per_night_default
      ? String(trip.cost_per_night_used)
      : ''
  const initialPerDiem =
    trip.per_diem_per_night_used !== trip.per_diem_per_night_default
      ? String(trip.per_diem_per_night_used)
      : ''

  const [skip, setSkip] = useState<boolean>(trip.is_skipped)
  const [skipReason, setSkipReason] = useState<string>(trip.skip_reason ?? '')
  const [nights, setNights] = useState<string>(initialNights)
  const [trips, setTrips] = useState<string>(initialTrips)
  const [costPerNight, setCostPerNight] = useState<string>(initialCost)
  const [perDiem, setPerDiem] = useState<string>(initialPerDiem)
  const [reason, setReason] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Live preview using the same arithmetic as the backend calculator.
  // crew_size + include_per_diem aren't in the trip — derive include
  // by whether per-diem cost was non-zero in the saved trip.
  const includePerDiem = trip.annual_per_diem_cost > 0 || trip.per_diem_per_night_default > 0
  const crewSizeFromTrip =
    trip.annual_per_diem_cost > 0 && trip.per_diem_per_night_used > 0 && trip.annual_nights > 0
      ? Math.round(
          trip.annual_per_diem_cost / (trip.annual_nights * trip.per_diem_per_night_used)
        )
      : 3
  const previewNights = skip
    ? 0
    : nights.trim() === ''
      ? trip.nights_per_trip_calculated
      : Math.max(0, Number(nights))
  const previewTrips = skip
    ? 0
    : trips.trim() === ''
      ? trip.trips_per_year_calculated
      : Math.max(0, Number(trips))
  const previewCost =
    costPerNight.trim() === '' ? trip.cost_per_night_default : Number(costPerNight)
  const previewPerDiem = perDiem.trim() === '' ? trip.per_diem_per_night_default : Number(perDiem)
  const previewAnnualNights = previewNights * previewTrips
  const previewHotel = previewAnnualNights * previewCost
  const previewPerDiemCost = includePerDiem
    ? previewAnnualNights * previewPerDiem * crewSizeFromTrip
    : 0
  const previewTotal = previewHotel + previewPerDiemCost
  const delta = previewTotal - trip.annual_total_cost

  const handleSave = async () => {
    if (skip && !skipReason.trim()) {
      setError('Reason is required when marking cluster as day-trip')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const token = await getToken()
      const res = await fetch(
        `/api/analyses/account/${accountId}/clients/${clientId}/cluster-override`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            cluster_id: trip.cluster_id,
            cluster_label: trip.cluster_label,
            skip_overnight: skip,
            skip_overnight_reason: skip ? skipReason.trim() : null,
            nights_per_trip_override:
              !skip && nights.trim() !== '' ? Math.max(0, Number(nights)) : null,
            trips_per_year_override:
              !skip && trips.trim() !== '' ? Math.max(0, Number(trips)) : null,
            cost_per_night_override:
              !skip && costPerNight.trim() !== '' ? Number(costPerNight) : null,
            per_diem_per_night_override:
              !skip && perDiem.trim() !== '' ? Number(perDiem) : null,
            override_reason: reason.trim() || null,
          }),
        }
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as any).error ?? `HTTP ${res.status}`)
      }
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async () => {
    setSaving(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(
        `/api/analyses/account/${accountId}/clients/${clientId}/cluster-override`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            cluster_id: trip.cluster_id,
            cluster_label: trip.cluster_label,
            skip_overnight: false,
            nights_per_trip_override: null,
            trips_per_year_override: null,
            cost_per_night_override: null,
            per_diem_per_night_override: null,
          }),
        }
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as any).error ?? `HTTP ${res.status}`)
      }
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{trip.cluster_label}</DialogTitle>
          <DialogDescription>
            From {trip.branch_name} · {trip.drive_hours_one_way} hr ·{' '}
            {trip.drive_distance_miles_one_way} mi one-way ·{' '}
            {trip.properties_in_cluster.length} propert
            {trip.properties_in_cluster.length === 1 ? 'y' : 'ies'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-border bg-surface-subtle p-3 text-xs space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-fg-subtle font-semibold">
              Calculated baseline
            </p>
            <p className="text-fg font-tabular leading-relaxed">
              {trip.calculation_text}
            </p>
          </div>

          <div className="space-y-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={skip}
                onChange={(e) => setSkip(e.target.checked)}
                className="mt-1 rounded border-border accent-accent"
                disabled={saving}
              />
              <div>
                <p className="text-sm font-medium text-fg">
                  Mark cluster as day-trip (no overnight)
                </p>
                <p className="text-xs text-fg-muted">
                  All overnight + per diem costs go to $0 for this cluster.
                </p>
              </div>
            </label>
            {skip && (
              <FormField label="Reason (required)">
                <Input
                  value={skipReason}
                  onChange={(e) => setSkipReason(e.target.value)}
                  placeholder="e.g. crew can do it as a long day trip"
                  disabled={saving}
                />
              </FormField>
            )}
          </div>

          <div className={skip ? 'opacity-50 pointer-events-none' : ''}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField
                label="Nights per trip"
                helper={`Calculated: ${trip.nights_per_trip_calculated}`}
              >
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={nights}
                  onChange={(e) => setNights(e.target.value)}
                  placeholder={String(trip.nights_per_trip_calculated)}
                  disabled={saving || skip}
                />
              </FormField>
              <FormField
                label="Trips per year"
                helper={`Calculated: ${trip.trips_per_year_calculated}`}
              >
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={trips}
                  onChange={(e) => setTrips(e.target.value)}
                  placeholder={String(trip.trips_per_year_calculated)}
                  disabled={saving || skip}
                />
              </FormField>
              <FormField
                label="Cost per night ($)"
                helper={`Default: $${trip.cost_per_night_default}`}
              >
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={costPerNight}
                  onChange={(e) => setCostPerNight(e.target.value)}
                  placeholder={String(trip.cost_per_night_default)}
                  disabled={saving || skip}
                />
              </FormField>
              <FormField
                label="Per diem per night ($)"
                helper={`Default: $${trip.per_diem_per_night_default}`}
              >
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={perDiem}
                  onChange={(e) => setPerDiem(e.target.value)}
                  placeholder={String(trip.per_diem_per_night_default)}
                  disabled={saving || skip}
                />
              </FormField>
            </div>
          </div>

          <FormField label="Reason (optional)">
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this overridden?"
              disabled={saving}
            />
          </FormField>

          <div className="rounded-md border border-accent/30 bg-accent/5 p-3 text-xs space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-fg-subtle font-semibold">
              Preview with overrides
            </p>
            {skip ? (
              <p className="text-fg font-tabular">
                $0 — cluster will be served as day trips
              </p>
            ) : (
              <>
                <p className="text-fg font-tabular">
                  Annual nights: {previewAnnualNights} · Annual cost: $
                  {Math.round(previewTotal).toLocaleString()}{' '}
                  <span
                    className={delta === 0 ? 'text-fg-subtle' : delta > 0 ? 'text-danger' : 'text-success'}
                  >
                    ({delta === 0 ? 'no change' : `${delta > 0 ? '+' : '−'}$${Math.abs(Math.round(delta)).toLocaleString()}`})
                  </span>
                </p>
                <p className="text-fg-muted font-tabular">
                  Hotel: {previewAnnualNights} × ${previewCost.toFixed(0)} = $
                  {Math.round(previewHotel).toLocaleString()}
                </p>
                <p className="text-fg-muted font-tabular">
                  Per diem: {previewAnnualNights} × {crewSizeFromTrip} crew × $
                  {previewPerDiem.toFixed(0)} = $
                  {Math.round(previewPerDiemCost).toLocaleString()}
                </p>
              </>
            )}
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          {trip.has_overrides || trip.is_skipped ? (
            <Button variant="ghost" onClick={handleClear} disabled={saving}>
              <RotateCcw className="h-3 w-3 mr-1" />
              Clear overrides
            </Button>
          ) : null}
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Saving…
              </>
            ) : (
              'Save'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
