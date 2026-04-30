// Phase 4c — Scheduler page.
// Route: /accounts/:accountId/clients/:clientId/scheduler
//
// Form on top → POST /api/scheduler/route-day → results below
// (summary stats + map + timeline + saved schedules list).
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Calendar, MapPin, AlertTriangle, Search, Save } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import AppShell from '../../components/layout/AppShell'
import Button from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Card, CardTitle, CardDescription } from '../../components/ui/Card'
import { Input, FormField } from '../../components/ui/Input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../components/ui/Select'
import { EmptyState } from '../../components/ui/EmptyState'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../components/ui/Table'
import RouteMap, { type RouteMapStop } from '../../components/scheduler/RouteMap'
import { cn } from '../../lib/cn'

interface Branch { name: string; lat: number; lng: number; city_state?: string }
interface SLRow {
  service_location_id: string
  display_name: string | null
  property: { property_id: string; address_line1: string; city: string | null; state: string | null; latitude: number | null; longitude: number | null } | null
  status: string
}

interface RouteStop {
  sequence: number
  service_location_id: string
  property_id: string
  address: string
  arrival_time: string
  departure_time: string
  drive_minutes_from_previous: number
  drive_distance_miles_from_previous: number
  work_minutes: number
  constraint_violations: Array<{
    constraint_id: string
    constraint_type: string
    severity: 'hard' | 'soft'
    description: string
    category: 'enforceable' | 'informational'
    satisfied: boolean
  }>
}

interface RoutingResult {
  status: 'optimized' | 'infeasible' | 'partial'
  route: RouteStop[]
  excluded_properties: Array<{
    service_location_id: string
    address: string
    reason: string
    detail: string
  }>
  summary: {
    properties_visited: number
    properties_excluded: number
    total_drive_minutes: number
    total_work_minutes: number
    total_buffer_minutes: number
    total_day_minutes: number
    total_drive_miles: number
    start_time: string
    end_time: string
    hard_constraint_violations: number
    soft_constraint_violations: number
    optimization_score: number
  }
}

interface SavedSchedule {
  id: string
  name: string
  scheduled_date: string
  branch_name: string
  status: string
  total_day_minutes: number | null
  total_drive_miles: number | null
  optimization_score: number | null
  hard_constraint_violations: number | null
  soft_constraint_violations: number | null
  created_at: string
}

export default function SchedulerPage() {
  const { accountId, clientId } = useParams<{ accountId: string; clientId: string }>()
  const { getToken } = useAuth()

  const [branches, setBranches] = useState<Branch[]>([])
  const [sls, setSLs] = useState<SLRow[]>([])
  const [savedSchedules, setSavedSchedules] = useState<SavedSchedule[]>([])
  const [loadingInputs, setLoadingInputs] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [scheduledDate, setScheduledDate] = useState(() => tomorrow())
  const [branchName, setBranchName] = useState<string>('')
  const [filter, setFilter] = useState('')
  const [quickFilter, setQuickFilter] = useState<'all' | 'within_60' | 'outliers'>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [workStart, setWorkStart] = useState('08:00')
  const [workEnd, setWorkEnd] = useState('18:00')
  const [bufferMin, setBufferMin] = useState(15)
  const [returnToBranch, setReturnToBranch] = useState(true)
  const [objective, setObjective] = useState<'minimize_drive' | 'maximize_properties' | 'balanced'>('minimize_drive')
  const [allowHardViolation, setAllowHardViolation] = useState(false)

  // Result state
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<RoutingResult | null>(null)
  const [saving, setSaving] = useState(false)

  // ── Load form inputs (selected branches + service locations + saved schedules)
  const loadInputs = useCallback(async () => {
    if (!accountId || !clientId) return
    setLoadingInputs(true)
    setError(null)
    try {
      const token = await getToken()
      const [opcRes, slRes, schedRes] = await Promise.all([
        fetch(`/api/accounts/${accountId}/clients/${clientId}/operational-constraints`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/v1/service-locations?client_id=${clientId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/scheduler/schedules?account_id=${accountId}&client_id=${clientId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ])
      if (!opcRes.ok) throw new Error(`Constraints load failed (${opcRes.status})`)
      const opc = await opcRes.json()
      const selBranches: Branch[] = opc.selected_branches ?? []
      setBranches(selBranches)
      if (selBranches.length > 0 && !branchName) setBranchName(selBranches[0].name)

      if (slRes.ok) {
        const data = await slRes.json()
        setSLs(data ?? [])
      }
      if (schedRes.ok) {
        const data = await schedRes.json()
        setSavedSchedules(data.schedules ?? [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingInputs(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, clientId, getToken])

  useEffect(() => { loadInputs() }, [loadInputs])

  const currentBranch = branches.find((b) => b.name === branchName) ?? null

  // SL list with computed distance from selected branch.
  const slWithDistance = useMemo(() => {
    if (!currentBranch) return [] as Array<SLRow & { distance_mi: number | null }>
    return sls.map((sl) => {
      const lat = sl.property?.latitude
      const lng = sl.property?.longitude
      let distance_mi: number | null = null
      if (lat != null && lng != null) {
        distance_mi = haversine(currentBranch.lat, currentBranch.lng, lat, lng)
      }
      return { ...sl, distance_mi }
    })
  }, [sls, currentBranch])

  const filteredSLs = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return slWithDistance.filter((sl) => {
      if (q) {
        const hay = `${sl.display_name ?? ''} ${sl.property?.address_line1 ?? ''} ${sl.property?.city ?? ''} ${sl.property?.state ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      const minutesFromBranch = sl.distance_mi != null ? (sl.distance_mi / 60) * 60 : Infinity
      if (quickFilter === 'within_60' && minutesFromBranch > 60) return false
      if (quickFilter === 'outliers' && minutesFromBranch < 180) return false
      return true
    })
  }, [slWithDistance, filter, quickFilter])

  function toggleSL(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }
  function selectAllFiltered() {
    setSelected(new Set(filteredSLs.map((s) => s.service_location_id)))
  }

  async function handleCompute() {
    if (!accountId || !clientId || !branchName || selected.size === 0) return
    setRunning(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/scheduler/route-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          account_id: accountId,
          client_id: clientId,
          scheduled_date: scheduledDate,
          branch_name: branchName,
          service_location_ids: Array.from(selected),
          config: {
            work_start_time: workStart,
            work_end_time: workEnd,
            buffer_minutes_per_stop: bufferMin,
            return_to_branch: returnToBranch,
          },
          preferences: {
            objective,
            soft_constraint_weight: 0.5,
            allow_hard_constraint_violation: allowHardViolation,
          },
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `Compute failed (${res.status})`)
      setResult(body.result as RoutingResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  async function handleSave() {
    if (!accountId || !clientId || !branchName || !result) return
    setSaving(true)
    try {
      const token = await getToken()
      const res = await fetch('/api/scheduler/route-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          account_id: accountId,
          client_id: clientId,
          scheduled_date: scheduledDate,
          branch_name: branchName,
          service_location_ids: Array.from(selected),
          config: {
            work_start_time: workStart,
            work_end_time: workEnd,
            buffer_minutes_per_stop: bufferMin,
            return_to_branch: returnToBranch,
          },
          preferences: {
            objective,
            soft_constraint_weight: 0.5,
            allow_hard_constraint_violation: allowHardViolation,
          },
          save_as_draft: true,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `Save failed (${res.status})`)
      await loadInputs()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const mapStops: RouteMapStop[] = useMemo(() => {
    if (!result) return []
    // Need lat/lng for each stop — pull from SL list.
    return result.route
      .map((s) => {
        const sl = sls.find((x) => x.service_location_id === s.service_location_id)
        if (!sl?.property?.latitude || !sl?.property?.longitude) return null
        return {
          sequence: s.sequence,
          service_location_id: s.service_location_id,
          lat: sl.property.latitude,
          lng: sl.property.longitude,
          address: s.address,
        }
      })
      .filter((x): x is RouteMapStop => x !== null)
  }, [result, sls])

  if (loadingInputs) {
    return (
      <AppShell>
        <div className="mx-auto max-w-6xl px-6 py-10">
          <p className="text-sm text-fg-muted">Loading scheduler…</p>
        </div>
      </AppShell>
    )
  }

  if (branches.length === 0) {
    return (
      <AppShell breadcrumb={[{ label: 'Scheduler' }]}>
        <div className="mx-auto max-w-6xl px-6 py-10">
          <EmptyState
            title="Select branches before scheduling"
            description="Run Branch Optimization on the analysis dashboard, then confirm a branch selection. The scheduler routes from a confirmed branch."
            action={
              <Button asChild variant="secondary">
                <Link to={`/accounts/${accountId}/clients/${clientId}/analysis`}>
                  Go to analysis
                </Link>
              </Button>
            }
          />
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell breadcrumb={[{ label: 'Accounts', to: '/accounts' }, { label: 'Scheduler' }]}>
      <div className="mx-auto max-w-7xl px-6 py-10 space-y-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Scheduler</h1>
          <p className="text-sm text-fg-muted">
            Plan a single day's route from one branch. Multi-day, multi-crew, and recurring schedules ship in later phases.
          </p>
        </header>

        {error && (
          <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Form column */}
          <Card className="space-y-4 lg:col-span-1">
            <CardTitle>Plan a day</CardTitle>

            <FormField label="Date" htmlFor="sched-date">
              <Input
                id="sched-date"
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
              />
            </FormField>

            <FormField label="Branch">
              <Select value={branchName} onValueChange={setBranchName}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.name} value={b.name}>
                      {b.city_state ?? b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <details className="rounded-md border border-border">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-fg">
                Day window & buffer
              </summary>
              <div className="space-y-3 px-3 py-2 border-t border-border">
                <FormField label="Work start time">
                  <Input type="time" value={workStart} onChange={(e) => setWorkStart(e.target.value)} />
                </FormField>
                <FormField label="Work end time">
                  <Input type="time" value={workEnd} onChange={(e) => setWorkEnd(e.target.value)} />
                </FormField>
                <FormField label="Buffer per stop (min)">
                  <Input
                    type="number"
                    min={0}
                    value={bufferMin}
                    onChange={(e) => setBufferMin(Number(e.target.value) || 0)}
                  />
                </FormField>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={returnToBranch}
                    onChange={(e) => setReturnToBranch(e.target.checked)}
                    className="rounded border-border accent-accent"
                  />
                  Return to branch at end of day
                </label>
              </div>
            </details>

            <FormField label="Optimization objective">
              <div className="space-y-1">
                {(['minimize_drive', 'maximize_properties', 'balanced'] as const).map((o) => (
                  <label key={o} className="flex items-start gap-2 text-xs">
                    <input
                      type="radio"
                      name="objective"
                      checked={objective === o}
                      onChange={() => setObjective(o)}
                      className="mt-0.5 border-border accent-accent"
                    />
                    <span className="text-fg">
                      <span className="font-medium capitalize">{o.replace(/_/g, ' ')}</span>
                      <span className="block text-fg-subtle">
                        {o === 'minimize_drive' && 'Minimize total drive time (recommended).'}
                        {o === 'maximize_properties' && 'Pack as many stops as possible into the day.'}
                        {o === 'balanced' && 'Half-and-half between drive minimization and property count.'}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </FormField>

            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={allowHardViolation}
                onChange={(e) => setAllowHardViolation(e.target.checked)}
                className="rounded border-border accent-accent"
              />
              Allow hard constraint violations
            </label>

            <Button
              onClick={handleCompute}
              loading={running}
              disabled={selected.size === 0}
              className="w-full"
            >
              Compute route ({selected.size})
            </Button>
          </Card>

          {/* Property selector + filter */}
          <Card padding="none" className="lg:col-span-2 flex flex-col">
            <div className="border-b border-border px-4 py-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Candidate properties</CardTitle>
                <span className="text-xs text-fg-muted">
                  <span className="font-tabular">{selected.size}</span> selected ·{' '}
                  <span className="font-tabular">{filteredSLs.length}</span> shown
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-subtle" />
                  <Input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filter by name, address, city, state…"
                    className="pl-8"
                  />
                </div>
                <Select value={quickFilter} onValueChange={(v) => setQuickFilter(v as any)}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="within_60">Within 60min of branch</SelectItem>
                    <SelectItem value="outliers">Outliers (3hr+)</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="ghost" onClick={selectAllFiltered}>
                  Select all
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </div>
            </div>
            <div className="flex-1 max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Address</TableHead>
                    <TableHead>City / state</TableHead>
                    <TableHead className="text-right">Distance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSLs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-fg-muted text-sm">
                        No properties match.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredSLs.map((sl) => (
                      <TableRow key={sl.service_location_id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selected.has(sl.service_location_id)}
                            onChange={() => toggleSL(sl.service_location_id)}
                            className="rounded border-border accent-accent"
                          />
                        </TableCell>
                        <TableCell className="text-sm">
                          {sl.display_name ?? sl.property?.address_line1 ?? sl.service_location_id.slice(0, 8)}
                        </TableCell>
                        <TableCell className="text-xs text-fg-muted">
                          {sl.property?.city}
                          {sl.property?.state ? `, ${sl.property.state}` : ''}
                        </TableCell>
                        <TableCell numeric>
                          {sl.distance_mi != null ? (
                            <span>
                              {Math.round(sl.distance_mi)} mi
                              <span className="text-fg-subtle ml-1">
                                ({Math.round((sl.distance_mi / 60) * 60)} min)
                              </span>
                            </span>
                          ) : (
                            <span className="text-fg-subtle">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>

        {/* Result */}
        {result && (
          <ResultSection
            result={result}
            branch={currentBranch ? { name: currentBranch.name, lat: currentBranch.lat, lng: currentBranch.lng } : null}
            mapStops={mapStops}
            returnToBranch={returnToBranch}
            onSave={handleSave}
            saving={saving}
            onDiscard={() => setResult(null)}
          />
        )}

        {/* Saved schedules */}
        <section>
          <h2 className="text-base font-semibold tracking-tight text-fg mb-3">Saved schedules</h2>
          {savedSchedules.length === 0 ? (
            <p className="text-sm text-fg-muted">No schedules saved yet.</p>
          ) : (
            <Card padding="none">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Day duration</TableHead>
                    <TableHead>Drive (mi)</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {savedSchedules.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-tabular text-sm">{s.scheduled_date}</TableCell>
                      <TableCell>{s.branch_name}</TableCell>
                      <TableCell numeric>
                        {s.total_day_minutes != null ? formatMinutes(s.total_day_minutes) : '—'}
                      </TableCell>
                      <TableCell numeric>
                        {s.total_drive_miles != null ? `${Math.round(s.total_drive_miles)} mi` : '—'}
                      </TableCell>
                      <TableCell numeric>
                        {s.optimization_score != null ? Math.round(s.optimization_score) : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={badgeForStatus(s.status)}>{s.status}</Badge>
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </section>
      </div>
    </AppShell>
  )
}

function ResultSection({
  result,
  branch,
  mapStops,
  returnToBranch,
  onSave,
  saving,
  onDiscard,
}: {
  result: RoutingResult
  branch: { name: string; lat: number; lng: number } | null
  mapStops: RouteMapStop[]
  returnToBranch: boolean
  onSave: () => void
  saving: boolean
  onDiscard: () => void
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight text-fg">Route preview</h2>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onDiscard}>Discard</Button>
          <Button onClick={onSave} loading={saving} disabled={result.status === 'infeasible'}>
            <Save className="h-3.5 w-3.5" />
            Save as draft
          </Button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Properties visited"
          value={`${result.summary.properties_visited} of ${result.summary.properties_visited + result.summary.properties_excluded}`}
        />
        <StatCard
          label="Day duration"
          value={formatMinutes(result.summary.total_day_minutes)}
          sub={`${result.summary.start_time}–${result.summary.end_time}`}
        />
        <StatCard
          label="Total drive"
          value={`${formatMinutes(result.summary.total_drive_minutes)} · ${Math.round(result.summary.total_drive_miles)} mi`}
        />
        <StatCard
          label="Optimization score"
          value={`${result.summary.optimization_score}/100`}
          sub={`${result.summary.hard_constraint_violations} hard · ${result.summary.soft_constraint_violations} soft`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Timeline */}
        <Card padding="md" className="lg:col-span-1 max-h-[600px] overflow-y-auto">
          <CardTitle>Timeline</CardTitle>
          {result.route.length === 0 ? (
            <p className="mt-3 text-sm text-fg-muted">
              No properties fit in the day window. See excluded list below.
            </p>
          ) : (
            <ol className="mt-3 space-y-3">
              <TimelineItem
                badge="🏠"
                label={branch?.name ?? 'Branch'}
                detail={`Departure ${result.summary.start_time}`}
              />
              {result.route.map((stop, i) => {
                const next = result.route[i + 1]
                return (
                  <RouteStopCard
                    key={stop.service_location_id}
                    stop={stop}
                    nextDriveMin={next?.drive_minutes_from_previous}
                  />
                )
              })}
              {returnToBranch && (
                <TimelineItem
                  badge="🏠"
                  label={`Return to ${branch?.name ?? 'branch'}`}
                  detail={`Arrival ${result.summary.end_time}`}
                />
              )}
            </ol>
          )}
        </Card>

        {/* Map */}
        <div className="lg:col-span-2">
          {branch && mapStops.length > 0 ? (
            <RouteMap branch={branch} stops={mapStops} returnToBranch={returnToBranch} />
          ) : (
            <Card><CardDescription>Map unavailable — no plotted stops.</CardDescription></Card>
          )}
        </div>
      </div>

      {result.excluded_properties.length > 0 && (
        <Card>
          <CardTitle>
            Excluded
            <span className="ml-2 text-fg-muted font-mono font-normal">
              ({result.excluded_properties.length})
            </span>
          </CardTitle>
          <ul className="mt-3 divide-y divide-border">
            {result.excluded_properties.map((e) => (
              <li key={e.service_location_id} className="py-2 text-sm">
                <p className="text-fg">{e.address}</p>
                <p className="text-xs text-fg-muted">
                  <Badge variant="outline">{e.reason}</Badge>{' '}
                  {e.detail}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  )
}

function RouteStopCard({
  stop,
  nextDriveMin,
}: {
  stop: RouteStop
  nextDriveMin: number | undefined
}) {
  const arrival = stop.arrival_time.slice(11, 16)
  const departure = stop.departure_time.slice(11, 16)
  const violations = stop.constraint_violations.filter((v) => !v.satisfied || v.category === 'informational')
  return (
    <li>
      <div className="rounded-md border border-border bg-surface p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-fg-subtle">Stop {stop.sequence}</p>
            <p className="text-sm font-medium text-fg">{stop.address}</p>
          </div>
          <span className="text-xs text-fg-muted font-tabular whitespace-nowrap">
            {arrival}–{departure}
          </span>
        </div>
        <p className="mt-1 text-xs text-fg-muted font-tabular">
          Drive {stop.drive_minutes_from_previous}m · {stop.drive_distance_miles_from_previous}mi · Work {formatMinutes(stop.work_minutes)}
        </p>
        {violations.map((v, i) => (
          <div
            key={i}
            className={cn(
              'mt-1 flex items-start gap-1 text-[11px]',
              v.severity === 'hard' && !v.satisfied && 'text-danger',
              v.severity === 'soft' && !v.satisfied && 'text-warning',
              v.category === 'informational' && 'text-fg-subtle'
            )}
          >
            <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
            <span>{v.description}</span>
          </div>
        ))}
      </div>
      {nextDriveMin != null && (
        <div className="ml-3 my-1 text-xs text-fg-subtle font-tabular">↓ Drive {nextDriveMin}m</div>
      )}
    </li>
  )
}

function TimelineItem({ badge, label, detail }: { badge: string; label: string; detail: string }) {
  return (
    <li>
      <div className="rounded-md border border-border bg-surface-subtle p-3 flex items-center gap-3">
        <span className="text-lg">{badge}</span>
        <div>
          <p className="text-sm font-medium text-fg">{label}</p>
          <p className="text-xs text-fg-muted font-tabular">{detail}</p>
        </div>
      </div>
    </li>
  )
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-fg-subtle">{label}</p>
      <p className="font-mono text-base font-semibold tabular-nums text-fg leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-fg-muted font-tabular">{sub}</p>}
    </div>
  )
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function badgeForStatus(s: string): 'default' | 'success' | 'warning' | 'danger' | 'outline' | 'accent' {
  switch (s) {
    case 'committed': return 'success'
    case 'optimized': return 'accent'
    case 'optimizing': return 'warning'
    case 'failed': return 'danger'
    case 'cancelled': return 'outline'
    default: return 'default'
  }
}

function tomorrow(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (x: number) => (x * Math.PI) / 180
  const R = 3958.7613
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
