// Travel & trip planner page —
// /accounts/:accountId/clients/:clientId/travel
//
// Surfaces every property the client serves with its assigned branch
// + drive miles, lets the user group properties into trips, and
// computes annual nights / miles / cost for each saved trip. The
// "Suggest trips" action wraps the existing density-cluster math to
// propose groupings the user can accept verbatim.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Plus, Sparkles, Trash2, Pencil, MapPin, Route } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import AppShell from '../../components/layout/AppShell'
import Button from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Card, CardTitle, CardDescription } from '../../components/ui/Card'
import { Input, FormField, Textarea } from '../../components/ui/Input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/Dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/Table'

interface TravelProperty {
  property_id: string
  address_line1: string | null
  city: string | null
  state: string | null
  lat: number | null
  lng: number | null
  assigned_branch: string | null
  assigned_branch_city_state: string | null
  miles_to_branch: number
  drive_minutes_to_branch: number
}

interface ManualTripWithMetrics {
  id: string
  name: string
  branch_name: string
  property_ids: string[]
  visits_per_year: number
  notes: string | null
  property_count: number
  properties_missing_coords: number
  miles_per_trip: number
  annual_miles: number
  one_way_drive_hours_to_centroid: number
  is_overnight: boolean
  nights_per_trip: number
  annual_nights: number
  annual_hotel_cost: number
  annual_per_diem_cost: number
  annual_lodging_cost: number
}

interface BranchInfo {
  name: string
  city_state: string | null
  lat: number
  lng: number
}

interface Suggestion {
  suggested_name: string
  branch_name: string
  branch_city_state: string | null
  property_ids: string[]
  addresses: string[]
  one_way_drive_hours_to_centroid: number
  miles_per_trip_estimate: number
  estimated_nights_per_trip: number
  rationale: string
}

export default function TravelPlannerPage() {
  const { accountId, clientId } = useParams<{ accountId: string; clientId: string }>()
  const { getToken } = useAuth()
  const [trips, setTrips] = useState<ManualTripWithMetrics[]>([])
  const [properties, setProperties] = useState<TravelProperty[]>([])
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [account, setAccount] = useState<{ name: string; display_name: string | null } | null>(null)
  const [client, setClient] = useState<{ name: string; display_name: string | null } | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<ManualTripWithMetrics | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [propertyFilter, setPropertyFilter] = useState('')
  const [branchFilter, setBranchFilter] = useState<string>('all')

  const refresh = useCallback(async () => {
    if (!clientId || !accountId) return
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      const [tripsRes, accRes, cliRes] = await Promise.all([
        fetch(`/api/v1/clients/${clientId}/manual-trips`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/accounts/${accountId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/v1/clients/${clientId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ])
      if (!tripsRes.ok) throw new Error(`HTTP ${tripsRes.status}`)
      const tripsJson = await tripsRes.json()
      setTrips(tripsJson.trips ?? [])
      setProperties(tripsJson.properties ?? [])
      setBranches(tripsJson.branches ?? [])
      if (accRes.ok) {
        const j = await accRes.json()
        setAccount(j.account ?? j)
      }
      if (cliRes.ok) setClient(await cliRes.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [accountId, clientId, getToken])

  useEffect(() => {
    refresh()
  }, [refresh])

  const propsInTrips = useMemo(() => {
    const s = new Set<string>()
    for (const t of trips) for (const id of t.property_ids) s.add(id)
    return s
  }, [trips])

  const filteredProperties = useMemo(() => {
    const q = propertyFilter.trim().toLowerCase()
    return properties.filter((p) => {
      if (branchFilter !== 'all' && p.assigned_branch !== branchFilter) return false
      if (!q) return true
      const hay = `${p.address_line1 ?? ''} ${p.city ?? ''} ${p.state ?? ''} ${p.assigned_branch_city_state ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [properties, propertyFilter, branchFilter])

  const totalAnnualNights = trips.reduce((s, t) => s + t.annual_nights, 0)
  const totalAnnualMiles = trips.reduce((s, t) => s + t.annual_miles, 0)
  const totalAnnualLodging = trips.reduce((s, t) => s + t.annual_lodging_cost, 0)

  const suggestTrips = async () => {
    if (!clientId) return
    setSuggesting(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/clients/${clientId}/manual-trips/suggest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          exclude_property_ids: Array.from(propsInTrips),
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as any).error ?? `HTTP ${res.status}`)
      }
      const j = await res.json()
      setSuggestions(j.suggestions ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSuggesting(false)
    }
  }

  const acceptSuggestion = async (s: Suggestion) => {
    if (!clientId) return
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/clients/${clientId}/manual-trips`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: s.suggested_name,
          branch_name: s.branch_name,
          property_ids: s.property_ids,
          visits_per_year: 2,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as any).error ?? `HTTP ${res.status}`)
      }
      // Hide accepted suggestion from the list
      setSuggestions((prev) =>
        prev ? prev.filter((x) => x.suggested_name !== s.suggested_name) : prev
      )
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const deleteTrip = async (tripId: string) => {
    if (!clientId) return
    if (!confirm('Delete this trip?')) return
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/clients/${clientId}/manual-trips`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ trip_id: tripId }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as any).error ?? `HTTP ${res.status}`)
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <AppShell
      breadcrumb={[
        { label: 'Accounts', to: '/accounts' },
        { label: account?.display_name ?? account?.name ?? '…', to: `/accounts/${accountId}` },
        { label: client?.display_name ?? client?.name ?? '…' },
        { label: 'Travel & trips' },
      ]}
    >
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        <header className="flex items-start justify-between gap-6 flex-wrap">
          <div className="space-y-1 min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-fg">
              Travel & trip planner
            </h1>
            <p className="text-sm text-fg-muted max-w-2xl">
              Group properties into trips. The system computes nights,
              fuel miles, and lodging cost from your trips. These override
              the auto-clustered overnight calculation in Bid Pricing.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={suggestTrips} loading={suggesting}>
              <Sparkles className="h-4 w-4" />
              Suggest trips
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              New trip
            </Button>
          </div>
        </header>

        {error && (
          <p className="text-sm text-danger">Error: {error}</p>
        )}

        {loading ? (
          <p className="text-sm text-fg-muted">Loading…</p>
        ) : (
          <>
            {/* Aggregate stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card padding="sm">
                <p className="text-[10px] uppercase tracking-wider text-fg-subtle">Trips</p>
                <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-fg">
                  {trips.length}
                </p>
              </Card>
              <Card padding="sm">
                <p className="text-[10px] uppercase tracking-wider text-fg-subtle">Annual nights</p>
                <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-fg">
                  {totalAnnualNights.toLocaleString()}
                </p>
              </Card>
              <Card padding="sm">
                <p className="text-[10px] uppercase tracking-wider text-fg-subtle">Annual miles</p>
                <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-fg">
                  {Math.round(totalAnnualMiles).toLocaleString()}
                </p>
              </Card>
              <Card padding="sm">
                <p className="text-[10px] uppercase tracking-wider text-fg-subtle">Annual lodging</p>
                <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-fg">
                  ${totalAnnualLodging.toLocaleString()}
                </p>
              </Card>
            </div>

            {/* Suggestions panel */}
            {suggestions && suggestions.length > 0 && (
              <Card padding="md" className="border-accent/40 bg-accent-subtle/40">
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <CardTitle>
                    <Sparkles className="inline h-4 w-4 mr-1.5 text-accent" />
                    Suggested trips
                  </CardTitle>
                  <button
                    type="button"
                    className="text-xs text-fg-subtle hover:text-fg"
                    onClick={() => setSuggestions(null)}
                  >
                    Dismiss
                  </button>
                </div>
                <CardDescription>
                  Auto-clustered from properties not yet in a trip.
                  Click "Accept" to save as-is or copy the IDs into a new
                  manual trip if you want to adjust.
                </CardDescription>
                <ul className="mt-3 space-y-2">
                  {suggestions.map((s, i) => (
                    <li
                      key={i}
                      className="rounded-md border border-border bg-surface p-3"
                    >
                      <div className="flex items-baseline justify-between gap-3 flex-wrap">
                        <div>
                          <p className="font-semibold text-fg">{s.suggested_name}</p>
                          <p className="text-xs text-fg-muted mt-0.5">
                            {s.rationale}
                          </p>
                        </div>
                        <Button size="sm" onClick={() => acceptSuggestion(s)}>
                          Accept
                        </Button>
                      </div>
                      <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-fg-muted">
                        <div>
                          <span className="text-fg-subtle">Properties:</span>{' '}
                          <span className="font-tabular text-fg">{s.property_ids.length}</span>
                        </div>
                        <div>
                          <span className="text-fg-subtle">Drive:</span>{' '}
                          <span className="font-tabular text-fg">
                            {s.one_way_drive_hours_to_centroid} hr
                          </span>
                        </div>
                        <div>
                          <span className="text-fg-subtle">Miles/trip:</span>{' '}
                          <span className="font-tabular text-fg">
                            {s.miles_per_trip_estimate}
                          </span>
                        </div>
                        <div>
                          <span className="text-fg-subtle">Nights/trip:</span>{' '}
                          <span className="font-tabular text-fg">
                            {s.estimated_nights_per_trip}
                          </span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {suggestions && suggestions.length === 0 && (
              <Card padding="md">
                <p className="text-sm text-fg-muted">
                  No more trip suggestions — every remote property is
                  already in a saved trip, or no clusters meet the
                  overnight threshold.
                </p>
              </Card>
            )}

            {/* Saved trips */}
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-fg">Saved trips ({trips.length})</h2>
              {trips.length === 0 ? (
                <Card padding="md">
                  <p className="text-sm text-fg-muted">
                    No trips saved yet. Click "Suggest trips" to auto-group
                    your remote properties, or "New trip" to build one
                    manually.
                  </p>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {trips.map((t) => (
                    <Card key={t.id} padding="md">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <CardTitle>{t.name}</CardTitle>
                          <p className="text-xs text-fg-muted mt-0.5">
                            <Route className="inline h-3 w-3 mr-1" />
                            from {t.branch_name} ·{' '}
                            <span className="font-tabular">{t.property_count}</span>{' '}
                            propert
                            {t.property_count === 1 ? 'y' : 'ies'}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => setEditing(t)}
                            className="text-fg-subtle hover:text-accent"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteTrip(t.id)}
                            className="text-fg-subtle hover:text-danger"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      {t.is_overnight ? (
                        <Badge variant="warning" className="mt-2 text-[10px]">
                          Overnight ({t.one_way_drive_hours_to_centroid} hr drive)
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="mt-2 text-[10px]">
                          Day-trip
                        </Badge>
                      )}
                      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <Stat label="Visits/yr" value={t.visits_per_year} />
                        <Stat label="Nights/trip" value={t.nights_per_trip} />
                        <Stat label="Annual nights" value={t.annual_nights} />
                        <Stat label="Annual miles" value={Math.round(t.annual_miles).toLocaleString()} />
                        <Stat
                          label="Annual lodging"
                          value={`$${t.annual_lodging_cost.toLocaleString()}`}
                        />
                        <Stat label="Miles/trip" value={t.miles_per_trip} />
                      </dl>
                      {t.properties_missing_coords > 0 && (
                        <p className="mt-2 text-[11px] text-warning">
                          ⚠ {t.properties_missing_coords} propert
                          {t.properties_missing_coords === 1 ? 'y has' : 'ies have'} missing
                          lat/lng — excluded from miles + nights math.
                        </p>
                      )}
                      {t.notes && (
                        <p className="mt-2 text-xs italic text-fg-muted border-t border-border pt-2">
                          {t.notes}
                        </p>
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </section>

            {/* Property table */}
            <section className="space-y-2">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <h2 className="text-sm font-semibold text-fg">
                  Properties ({properties.length})
                </h2>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Filter by address / city / state…"
                    value={propertyFilter}
                    onChange={(e) => setPropertyFilter(e.target.value)}
                    className="max-w-xs h-8 text-xs"
                  />
                  <select
                    value={branchFilter}
                    onChange={(e) => setBranchFilter(e.target.value)}
                    className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-fg"
                  >
                    <option value="all">All branches</option>
                    {branches.map((b) => (
                      <option key={b.name} value={b.name}>
                        {b.city_state || b.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="rounded-md border border-border bg-surface overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Property</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead className="text-right">Distance</TableHead>
                      <TableHead className="text-right">Drive</TableHead>
                      <TableHead>Trip</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredProperties.map((p) => {
                      const inTrip = trips.find((t) => t.property_ids.includes(p.property_id))
                      return (
                        <TableRow key={p.property_id}>
                          <TableCell className="text-fg">
                            <p className="font-medium">{p.address_line1 ?? '—'}</p>
                            <p className="text-xs text-fg-subtle">
                              {p.city}{p.city && p.state ? ', ' : ''}{p.state}
                            </p>
                          </TableCell>
                          <TableCell className="text-xs text-fg-muted">
                            <MapPin className="inline h-3 w-3 mr-0.5" />
                            {p.assigned_branch_city_state || p.assigned_branch || '—'}
                          </TableCell>
                          <TableCell numeric className="text-xs">
                            {p.miles_to_branch != null ? `${p.miles_to_branch} mi` : '—'}
                          </TableCell>
                          <TableCell numeric className="text-xs text-fg-muted">
                            {p.drive_minutes_to_branch
                              ? `${p.drive_minutes_to_branch} min`
                              : '—'}
                          </TableCell>
                          <TableCell className="text-xs">
                            {inTrip ? (
                              <Badge variant="accent" className="text-[10px]">
                                {inTrip.name}
                              </Badge>
                            ) : (
                              <span className="text-fg-subtle italic">unassigned</span>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </section>
          </>
        )}
      </div>

      <TripDialog
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        clientId={clientId!}
        existingTrip={editing}
        properties={properties}
        branches={branches}
        propsAlreadyInOtherTrips={
          editing
            ? new Set(
                Array.from(propsInTrips).filter(
                  (id) => !editing.property_ids.includes(id)
                )
              )
            : propsInTrips
        }
        onSaved={() => {
          setCreating(false)
          setEditing(null)
          refresh()
        }}
      />
    </AppShell>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-fg-subtle">{label}</dt>
      <dd className="font-mono text-sm font-semibold tabular-nums text-fg">{value}</dd>
    </div>
  )
}

function TripDialog({
  open,
  onClose,
  clientId,
  existingTrip,
  properties,
  branches,
  propsAlreadyInOtherTrips,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  clientId: string
  existingTrip: ManualTripWithMetrics | null
  properties: TravelProperty[]
  branches: BranchInfo[]
  propsAlreadyInOtherTrips: Set<string>
  onSaved: () => void
}) {
  const { getToken } = useAuth()
  const [name, setName] = useState('')
  const [branchName, setBranchName] = useState('')
  const [visitsPerYear, setVisitsPerYear] = useState('2')
  const [notes, setNotes] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      if (existingTrip) {
        setName(existingTrip.name)
        setBranchName(existingTrip.branch_name)
        setVisitsPerYear(String(existingTrip.visits_per_year))
        setNotes(existingTrip.notes ?? '')
        setSelected(new Set(existingTrip.property_ids))
      } else {
        setName('')
        setBranchName(branches[0]?.name ?? '')
        setVisitsPerYear('2')
        setNotes('')
        setSelected(new Set())
      }
      setFilter('')
      setErr(null)
    }
  }, [open, existingTrip, branches])

  const filteredProps = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return properties.filter((p) => {
      if (propsAlreadyInOtherTrips.has(p.property_id)) return false
      if (branchName && p.assigned_branch && p.assigned_branch !== branchName) {
        // Don't filter strictly by branch — user might want to drag a
        // property in from another branch. Just deprioritize visually.
      }
      if (!q) return true
      const hay = `${p.address_line1 ?? ''} ${p.city ?? ''} ${p.state ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [properties, propsAlreadyInOtherTrips, filter, branchName])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const save = async () => {
    if (!name.trim()) {
      setErr('Name is required')
      return
    }
    if (!branchName) {
      setErr('Branch is required')
      return
    }
    if (selected.size === 0) {
      setErr('Select at least one property')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      const token = await getToken()
      const payload = {
        name: name.trim(),
        branch_name: branchName,
        property_ids: Array.from(selected),
        visits_per_year: Math.max(1, Math.floor(Number(visitsPerYear) || 1)),
        notes: notes.trim() || null,
      }
      const res = await fetch(`/api/v1/clients/${clientId}/manual-trips`, {
        method: existingTrip ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(
          existingTrip ? { ...payload, trip_id: existingTrip.id } : payload
        ),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as any).error ?? `HTTP ${res.status}`)
      }
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{existingTrip ? 'Edit trip' : 'New trip'}</DialogTitle>
          <DialogDescription>
            Group properties served on the same trip. Drives nights / fuel
            cost in Bid Pricing.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1 -mr-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Albuquerque area" />
            </FormField>
            <FormField label="Branch">
              <select
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg"
              >
                {branches.length === 0 && <option value="">(no branches)</option>}
                {branches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.city_state || b.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Visits per year">
              <Input
                type="number"
                min={1}
                value={visitsPerYear}
                onChange={(e) => setVisitsPerYear(e.target.value)}
              />
            </FormField>
            <FormField label="Notes (optional)">
              <Textarea rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </FormField>
          </div>
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-semibold text-fg">
                Properties ({selected.size} selected)
              </p>
              <Input
                placeholder="Filter…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="max-w-xs h-7 text-xs"
              />
            </div>
            <div className="rounded-md border border-border max-h-[40vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Property</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead className="text-right">Distance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProps.slice(0, 300).map((p) => {
                    const isSel = selected.has(p.property_id)
                    return (
                      <TableRow key={p.property_id}>
                        <TableCell className="w-8">
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() => toggle(p.property_id)}
                            className="rounded border-border accent-accent"
                          />
                        </TableCell>
                        <TableCell className="text-xs">
                          <p className="font-medium text-fg">{p.address_line1 ?? '—'}</p>
                          <p className="text-fg-subtle">
                            {p.city}{p.city && p.state ? ', ' : ''}{p.state}
                          </p>
                        </TableCell>
                        <TableCell className="text-xs text-fg-muted">
                          {p.assigned_branch_city_state ?? p.assigned_branch ?? '—'}
                        </TableCell>
                        <TableCell numeric className="text-xs">
                          {p.miles_to_branch} mi
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              {filteredProps.length > 300 && (
                <p className="px-3 py-2 text-xs text-fg-muted bg-surface-subtle">
                  Showing first 300 of {filteredProps.length}. Filter to narrow.
                </p>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          {err && (
            <p className="text-xs text-danger flex-1 sm:text-left text-center self-center">
              {err}
            </p>
          )}
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} loading={saving}>
            {existingTrip ? 'Save changes' : 'Create trip'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
