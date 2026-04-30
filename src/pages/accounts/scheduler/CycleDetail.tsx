// Phase 4d — Cycle instance detail.
// Summary cards + list view of crew_day_routes + visits with edit affordances
// (move/lock/mark-completed). Calendar grid + crew swimlanes deferred to 4f.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { Lock, Unlock, Check, MoveRight, Calendar } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import AppShell from '../../../components/layout/AppShell'
import Button from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { Card, CardTitle } from '../../../components/ui/Card'
import { Input, FormField } from '../../../components/ui/Input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../../../components/ui/Dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../../components/ui/Table'

interface Cycle {
  id: string
  template_id: string
  cycle_number: number
  start_date: string
  end_date: string
  status: string
}

interface Visit {
  id: string
  service_location_id: string
  property_id: string
  scheduled_date: string | null
  arrival_time: string | null
  departure_time: string | null
  sequence_in_day: number | null
  hours_per_visit_total: number | null
  status: string
  unplaced_reason: string | null
  is_locked: boolean
  attached_addons: Array<{ offering_name: string; hours: number; cohort_year: number }>
  service_locations?: { display_name: string | null; property: { address_line1: string } | null } | null
}

interface CrewDay {
  id: string
  trip_id: string
  crew_index: number
  scheduled_date: string
  day_type: string
  total_drive_minutes: number | null
  total_work_minutes: number | null
  total_day_minutes: number | null
  total_drive_miles: number | null
  trip_day_number: number | null
  trip_total_days: number | null
}

export default function CycleDetailPage() {
  const { accountId, clientId, cycleId } = useParams<{
    accountId: string; clientId: string; cycleId: string
  }>()
  const { getToken } = useAuth()
  const [cycle, setCycle] = useState<Cycle | null>(null)
  const [visits, setVisits] = useState<Visit[]>([])
  const [crewDays, setCrewDays] = useState<CrewDay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [moveTarget, setMoveTarget] = useState<Visit | null>(null)

  const load = useCallback(async () => {
    if (!cycleId) return
    setLoading(true)
    try {
      const token = await getToken()
      const res = await fetch(`/api/scheduler/cycles/${cycleId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`Load failed (${res.status})`)
      const data = await res.json()
      setCycle(data.cycle)
      setVisits(data.visits ?? [])
      setCrewDays(data.crew_days ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [cycleId, getToken])

  useEffect(() => { load() }, [load])

  const placedVisits = visits.filter((v) => v.status === 'placed')
  const unplacedVisits = visits.filter((v) => v.status === 'unplaced')
  const completedVisits = visits.filter((v) => v.status === 'completed')

  const summary = useMemo(() => {
    let driveMin = 0, workMin = 0, dayMin = 0, driveMiles = 0
    for (const cd of crewDays) {
      driveMin += cd.total_drive_minutes ?? 0
      workMin += cd.total_work_minutes ?? 0
      dayMin += cd.total_day_minutes ?? 0
      driveMiles += Number(cd.total_drive_miles ?? 0)
    }
    return { driveMin, workMin, dayMin, driveMiles }
  }, [crewDays])

  async function handleAction(visitId: string, path: string, body?: object) {
    try {
      const token = await getToken()
      const res = await fetch(`/api/scheduler/visits/${visitId}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error ?? `${path} failed (${res.status})`)
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (loading || !cycle) {
    return (
      <AppShell>
        <div className="mx-auto max-w-6xl px-6 py-10">
          <p className="text-sm text-fg-muted">{loading ? 'Loading…' : error ?? 'Cycle not found.'}</p>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell breadcrumb={[
      { label: 'Accounts', to: '/accounts' },
      { label: 'Routing templates', to: `/accounts/${accountId}/clients/${clientId}/scheduler/templates` },
      { label: `Cycle ${cycle.cycle_number}` },
    ]}>
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        <header className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold tracking-tight text-fg">
              Cycle {cycle.cycle_number}
            </h1>
            <Badge variant={cycle.status === 'completed' ? 'success' : cycle.status === 'in_progress' ? 'accent' : 'outline'}>
              {cycle.status}
            </Badge>
          </div>
          <p className="text-sm text-fg-muted font-tabular">
            <Calendar className="inline h-3.5 w-3.5 mr-1" />
            {cycle.start_date} — {cycle.end_date}
          </p>
        </header>

        {error && <p className="text-sm text-danger">{error}</p>}

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Visits placed" value={`${placedVisits.length} / ${visits.length}`} sub={`${unplacedVisits.length} unplaced · ${completedVisits.length} completed`} />
          <Stat label="Crew-days" value={String(crewDays.length)} />
          <Stat label="Drive" value={`${formatMin(summary.driveMin)} · ${Math.round(summary.driveMiles)} mi`} />
          <Stat label="Work" value={formatMin(summary.workMin)} />
        </div>

        {/* Crew days */}
        <Card padding="none">
          <div className="border-b border-border px-4 py-3">
            <CardTitle>Crew days</CardTitle>
          </div>
          {crewDays.length === 0 ? (
            <p className="px-4 py-6 text-sm text-fg-muted">No crew days in this cycle.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Crew</TableHead>
                  <TableHead>Trip</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Drive</TableHead>
                  <TableHead>Work</TableHead>
                  <TableHead>Day duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {crewDays.map((cd) => (
                  <TableRow key={cd.id}>
                    <TableCell className="text-xs font-tabular">{cd.scheduled_date}</TableCell>
                    <TableCell numeric>{cd.crew_index + 1}</TableCell>
                    <TableCell className="text-xs font-mono">
                      {cd.trip_id} {cd.trip_total_days && cd.trip_total_days > 1 ? `(d${cd.trip_day_number}/${cd.trip_total_days})` : ''}
                    </TableCell>
                    <TableCell>
                      <Badge variant={cd.day_type === 'overnight' ? 'warning' : 'outline'}>
                        {cd.day_type}
                      </Badge>
                    </TableCell>
                    <TableCell numeric className="text-xs">{formatMin(cd.total_drive_minutes ?? 0)} · {Math.round(Number(cd.total_drive_miles ?? 0))} mi</TableCell>
                    <TableCell numeric className="text-xs">{formatMin(cd.total_work_minutes ?? 0)}</TableCell>
                    <TableCell numeric className="text-xs">{formatMin(cd.total_day_minutes ?? 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        {/* Visits */}
        <Card padding="none">
          <div className="border-b border-border px-4 py-3">
            <CardTitle>Scheduled visits</CardTitle>
          </div>
          {visits.length === 0 ? (
            <p className="px-4 py-6 text-sm text-fg-muted">No visits scheduled.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Property</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Add-ons</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visits.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="text-xs font-tabular">{v.scheduled_date ?? '—'}</TableCell>
                    <TableCell className="text-xs font-tabular">
                      {v.arrival_time ?? '—'}{v.departure_time ? `–${v.departure_time}` : ''}
                    </TableCell>
                    <TableCell className="text-xs">
                      {v.service_locations?.display_name ?? v.service_locations?.property?.address_line1 ?? v.service_location_id.slice(0, 8)}
                    </TableCell>
                    <TableCell numeric className="text-xs">
                      {v.hours_per_visit_total != null ? `${Number(v.hours_per_visit_total).toFixed(1)}h` : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={
                        v.status === 'completed' ? 'success'
                        : v.status === 'unplaced' ? 'danger'
                        : v.is_locked ? 'accent'
                        : 'outline'
                      }>
                        {v.is_locked ? '🔒 ' : ''}{v.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {v.attached_addons.length === 0 ? (
                        <span className="text-fg-subtle">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {v.attached_addons.map((a, i) => (
                            <Badge key={i} variant="warning" title={`${a.hours}h · cohort ${a.cohort_year}`}>
                              + {a.offering_name}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {v.status === 'placed' && (
                          <>
                            <button
                              type="button"
                              onClick={() => v.is_locked
                                ? handleAction(v.id, 'unlock')
                                : handleAction(v.id, 'lock')
                              }
                              className="text-fg-subtle hover:text-accent"
                              title={v.is_locked ? 'Unlock' : 'Lock'}
                            >
                              {v.is_locked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => setMoveTarget(v)}
                              className="text-fg-subtle hover:text-accent"
                              title="Move"
                            >
                              <MoveRight className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAction(v.id, 'mark-completed', {})}
                              className="text-fg-subtle hover:text-success"
                              title="Mark completed"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>

      <MoveVisitDialog
        visit={moveTarget}
        onClose={() => setMoveTarget(null)}
        onMoved={() => { setMoveTarget(null); load() }}
      />
    </AppShell>
  )
}

function MoveVisitDialog({
  visit, onClose, onMoved,
}: { visit: Visit | null; onClose: () => void; onMoved: () => void }) {
  const { getToken } = useAuth()
  const [newDate, setNewDate] = useState<string>('')
  const [propagate, setPropagate] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (visit) {
      setNewDate(visit.scheduled_date ?? '')
      setPropagate(true)
      setError(null)
    }
  }, [visit])

  if (!visit) return null

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/scheduler/visits/${visit!.id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          new_scheduled_date: newDate,
          propagate_to_template: propagate,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Move failed (${res.status})`)
      }
      onMoved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={!!visit} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move visit</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <FormField label="New scheduled date">
            <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          </FormField>
          <FormField label="Apply this change to:">
            <div className="space-y-1">
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="radio"
                  checked={propagate}
                  onChange={() => setPropagate(true)}
                  className="mt-0.5 border-border accent-accent"
                />
                <span><span className="font-medium">This cycle and the template</span> — change repeats in future cycles (default)</span>
              </label>
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="radio"
                  checked={!propagate}
                  onChange={() => setPropagate(false)}
                  className="mt-0.5 border-border accent-accent"
                />
                <span><span className="font-medium">This cycle only</span> — one-time exception</span>
              </label>
            </div>
          </FormField>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={submitting}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-fg-subtle">{label}</p>
      <p className="font-mono text-base font-semibold tabular-nums text-fg leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-fg-muted font-tabular">{sub}</p>}
    </div>
  )
}

function formatMin(min: number): string {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}
