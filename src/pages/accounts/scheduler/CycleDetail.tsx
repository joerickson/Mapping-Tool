// Phase 4f-1 — Cycle instance detail with view switcher (Gantt /
// Calendar / List / Map), polished header summary, status bar, and
// undo/redo history drawer. Drag-drop + multi-select ship in 4f-2.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Lock, Unlock, Check, MoveRight, Calendar } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import AppShell from '../../../components/layout/AppShell'
import PreflightIssuesBanner from '../../../components/scheduler/PreflightIssuesBanner'
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
import ViewSwitcher, { type CycleViewKind } from '../../../components/scheduler/ViewSwitcher'
import GanttView, { type UtilDay } from '../../../components/scheduler/GanttView'
import CalendarView from '../../../components/scheduler/CalendarView'
import CycleMapView from '../../../components/scheduler/CycleMapView'
import HistoryDrawer from '../../../components/scheduler/HistoryDrawer'
import StatusBar, { type SaveState } from '../../../components/scheduler/StatusBar'

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
  crew_day_route_id: string | null
  attached_addons: Array<{ offering_name: string; hours: number; cohort_year: number }>
  service_locations?: { display_name: string | null; property: { address_line1: string } | null } | null
}

interface CrewDay {
  id: string
  trip_id: string
  trip_label: string | null
  crew_index: number
  scheduled_date: string
  day_type: string
  start_location: { type?: string; name?: string; lat?: number; lng?: number } | null
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
  const [utilDays, setUtilDays] = useState<UtilDay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [moveTarget, setMoveTarget] = useState<Visit | null>(null)
  const [view, setView] = useState<CycleViewKind>('gantt')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [optimizationScore, setOptimizationScore] = useState<number | null>(null)
  const [pacing, setPacing] = useState<any | null>(null)
  const [pacingWarnings, setPacingWarnings] = useState<Array<{ type: string; message: string }>>([])
  const [templateRequiredVisits, setTemplateRequiredVisits] = useState<number | null>(null)
  const [templateCrewCount, setTemplateCrewCount] = useState<number | null>(null)
  const [branches, setBranches] = useState<Array<{ name: string; lat: number; lng: number }>>([])
  const [selectedVisitIds, setSelectedVisitIds] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    if (!cycleId) return
    setLoading(true)
    try {
      const token = await getToken()
      const [cycleRes, utilRes] = await Promise.all([
        fetch(`/api/scheduler/cycles/${cycleId}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/scheduler/cycles/${cycleId}/crew-utilization`, { headers: { Authorization: `Bearer ${token}` } }),
      ])
      if (!cycleRes.ok) throw new Error(`Load failed (${cycleRes.status})`)
      const data = await cycleRes.json()
      setCycle(data.cycle)
      setVisits(data.visits ?? [])
      setCrewDays(data.crew_days ?? [])
      if (utilRes.ok) {
        const u = await utilRes.json()
        setUtilDays(u.days ?? [])
      }
      // Pull optimization score + branches from the parent template.
      if (data.cycle?.template_id) {
        const tplRes = await fetch(`/api/scheduler/templates/${data.cycle.template_id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (tplRes.ok) {
          const tpl = await tplRes.json()
          setOptimizationScore(tpl.template?.optimization_score ?? null)
          setPacing(tpl.template?.pacing_analysis ?? null)
          setPacingWarnings(
            Array.isArray(tpl.template?.warnings) ? tpl.template.warnings : []
          )
          setTemplateRequiredVisits(
            tpl.template?.total_visits_required_per_cycle ?? null
          )
          setTemplateCrewCount(tpl.template?.crew_count ?? null)
          setBranches(
            (tpl.template?.branches ?? []).map((b: any) => ({
              name: b.name,
              lat: Number(b.lat),
              lng: Number(b.lng),
            }))
          )
        }
      }
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
    setSaveState('saving')
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
      setSaveState('saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaveState('failed')
    }
  }

  // Bulk action helper — POSTs /visits/bulk-action so the entire bulk
  // shows up as one history entry (single Cmd+Z reverts the lot).
  async function handleBulkAction(action: 'move' | 'lock' | 'unlock' | 'mark_complete', visitIds: string[], payload?: Record<string, unknown>) {
    if (visitIds.length === 0) return
    setSaveState('saving')
    try {
      const token = await getToken()
      const res = await fetch('/api/scheduler/visits/bulk-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ visit_ids: visitIds, action, payload }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Bulk ${action} failed (${res.status})`)
      }
      await load()
      setSaveState('saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaveState('failed')
    }
  }

  // Resolve visit IDs for a set of (crew_index, date) cells. Visits know
  // their date directly and their crew via the linked crew_day_route.
  function visitsForCells(cells: Array<{ crew_index: number; date: string }>): string[] {
    const cellSet = new Set(cells.map((c) => `${c.crew_index}|${c.date}`))
    const crewByRouteId = new Map<string, number>()
    for (const cd of crewDays) crewByRouteId.set(cd.id, cd.crew_index)
    const ids: string[] = []
    for (const v of visits) {
      if (!v.scheduled_date || !v.crew_day_route_id) continue
      const ci = crewByRouteId.get(v.crew_day_route_id)
      if (ci == null) continue
      if (cellSet.has(`${ci}|${v.scheduled_date}`)) ids.push(v.id)
    }
    return ids
  }

  // Drag-drop drop handler. Opens a propagation prompt; on confirm,
  // bulk-moves the source day's visits to the target date.
  const [pendingDrop, setPendingDrop] = useState<{
    sourceVisitIds: string[]
    targetDate: string
    description: string
  } | null>(null)

  function handleCellDrop(drop: { source: { crew_index: number; date: string }; target: { crew_index: number; date: string } }) {
    const ids = visitsForCells([drop.source])
    if (ids.length === 0) return
    setPendingDrop({
      sourceVisitIds: ids,
      targetDate: drop.target.date,
      description: `Move ${ids.length} visit${ids.length === 1 ? '' : 's'} from ${drop.source.date} to ${drop.target.date}`,
    })
  }

  // One row per stop in each crew day so the user can see drive time
  // per property. Falls back to a one-row-per-day summary when a day
  // has no stops attached (e.g. travel day with start/end at branch).
  function exportCrewDaysCsv() {
    const header = [
      'Date',
      'Crew',
      'Trip',
      'Day type',
      'Trip day',
      'Stop #',
      'Property',
      'Drive min from previous',
      'Drive miles from previous',
      'Work min',
      'Arrival',
      'Departure',
      'Day total drive min',
      'Day total drive miles',
      'Day total work min',
      'Day total minutes',
    ]
    const rows: (string | number)[][] = [header]
    for (const cd of crewDays) {
      const route = Array.isArray((cd as any).route) ? ((cd as any).route as any[]) : []
      const tripDayLabel =
        cd.trip_total_days && cd.trip_total_days > 1
          ? `${cd.trip_day_number}/${cd.trip_total_days}`
          : ''
      const baseDayCols = [
        cd.total_drive_minutes ?? '',
        cd.total_drive_miles != null ? Math.round(Number(cd.total_drive_miles)) : '',
        cd.total_work_minutes ?? '',
        cd.total_day_minutes ?? '',
      ]
      if (route.length === 0) {
        rows.push([
          cd.scheduled_date ?? '',
          cd.crew_index + 1,
          cd.trip_label ?? '',
          cd.day_type,
          tripDayLabel,
          '', '', '', '', '', '', '',
          ...baseDayCols,
        ])
        continue
      }
      for (const stop of route) {
        rows.push([
          cd.scheduled_date ?? '',
          cd.crew_index + 1,
          cd.trip_label ?? '',
          cd.day_type,
          tripDayLabel,
          stop.sequence ?? '',
          stop.address ?? '',
          stop.drive_minutes_from_previous ?? '',
          stop.drive_distance_miles_from_previous ?? '',
          stop.work_minutes ?? '',
          stop.arrival_time ?? '',
          stop.departure_time ?? '',
          ...baseDayCols,
        ])
      }
    }
    const csv = rows
      .map((r) => r.map((c) => {
        const s = String(c ?? '')
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
        return s
      }).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cycle-${cycle?.cycle_number ?? 'export'}-crew-days.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function exportVisitsCsv() {
    const rows = [
      ['Date', 'Time', 'Property', 'Hours', 'Status', 'Locked', 'Add-ons'],
      ...visits.map((v) => [
        v.scheduled_date ?? '',
        v.arrival_time && v.departure_time ? `${v.arrival_time}–${v.departure_time}` : '',
        v.service_locations?.display_name ?? v.service_locations?.property?.address_line1 ?? v.service_location_id,
        v.hours_per_visit_total != null ? Number(v.hours_per_visit_total).toFixed(2) : '',
        v.status,
        v.is_locked ? 'yes' : 'no',
        v.attached_addons.map((a) => `${a.offering_name} (${a.cohort_year})`).join('; '),
      ]),
    ]
    const csv = rows
      .map((r) => r.map((c) => {
        const s = String(c ?? '')
        // Quote any cell containing comma, quote, or newline.
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
        return s
      }).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cycle-${cycle?.cycle_number ?? 'export'}-visits.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Today-jump counter — bumped on T key. GanttView re-scrolls when it changes.
  const [todayCounter, setTodayCounter] = useState(0)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement
      if (tgt?.tagName === 'INPUT' || tgt?.tagName === 'TEXTAREA' || tgt?.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        setTodayCounter((c) => c + 1)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Portfolio-level utilization stats, used by Gantt summary banner +
  // bottom status bar.
  const portfolioUtilization = useMemo(() => {
    if (utilDays.length === 0) return null
    const totalHours = utilDays.reduce((s, d) => s + d.work_hours_scheduled, 0)
    const totalCapacity = utilDays.reduce((s, d) => s + d.work_hours_capacity, 0)
    return totalCapacity > 0 ? Math.round((totalHours / totalCapacity) * 100) : 0
  }, [utilDays])

  const idleDayCount = useMemo(
    () => utilDays.filter((d) => d.state.kind === 'idle' || d.state.kind === 'between_trips').length,
    [utilDays]
  )

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
      <div className="mx-auto max-w-7xl px-6 py-10 space-y-6 pb-12">
        <header className="space-y-2">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
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
              {cycle.cycle_number > 1 && (
                <Link
                  to={`/accounts/${accountId}/clients/${clientId}/scheduler/compare?template=${cycle.template_id}&right=${cycle.id}`}
                  className="inline-flex items-center text-xs text-accent hover:underline mt-1"
                >
                  Compare to previous cycle ↗
                </Link>
              )}
            </div>
            <ViewSwitcher value={view} onChange={setView} />
          </div>
        </header>

        {error && <p className="text-sm text-danger">{error}</p>}

        {/* Phase 4e — preflight issues banner. Hides itself when nothing
            is open. Triggered automatically after auto-generation; can
            be re-run on demand. */}
        <PreflightIssuesBanner cycleId={cycle.id} />

        {/* Phase 4.4 — schedule-coverage banner. Critical for scenario
            analysis (e.g. did reducing crew_count from 4 to 3 silently
            drop properties?). Compares visits in the cycle against the
            template's expected count and surfaces unplaced rows. */}
        {(() => {
          const placedCount = placedVisits.length + completedVisits.length
          const unplacedCount = unplacedVisits.length
          const inCycle = visits.length
          const requiredTotal = templateRequiredVisits ?? inCycle
          const missingFromCycle = Math.max(0, requiredTotal - inCycle)
          const totalMissing = missingFromCycle + unplacedCount
          if (totalMissing === 0) return null
          const tone = totalMissing > placedCount * 0.05 ? 'danger' : 'warning'
          const wrap =
            tone === 'danger'
              ? 'border-danger/40 bg-danger-subtle text-fg'
              : 'border-warning/40 bg-warning-subtle text-fg'
          return (
            <div className={`rounded-md border px-4 py-3 ${wrap}`}>
              <p className="text-sm font-semibold">
                ⚠ {totalMissing} of {requiredTotal} visit
                {requiredTotal === 1 ? '' : 's'} couldn't be scheduled
                {templateCrewCount != null ? ` with crew_count=${templateCrewCount}` : ''}.
              </p>
              <ul className="mt-1.5 text-xs text-fg-muted space-y-0.5">
                {missingFromCycle > 0 && (
                  <li>
                    <span className="font-tabular font-medium text-fg">{missingFromCycle}</span>{' '}
                    were dropped before reaching the cycle (template build couldn't fit them).
                  </li>
                )}
                {unplacedCount > 0 && (
                  <li>
                    <span className="font-tabular font-medium text-fg">{unplacedCount}</span>{' '}
                    landed in the cycle as <code className="rounded bg-surface-subtle px-1 text-[11px]">unplaced</code>{' '}
                    — see them in the visits list filtered by status.
                  </li>
                )}
                <li className="mt-1">
                  Try adding a crew, extending the cycle, or removing
                  constraints. For scenario analysis, this is the headline
                  number — record it before changing crew_count again.
                </li>
              </ul>
            </div>
          )
        })()}

        {/* Polished summary cards (4 across). Color-coded for at-a-
            glance status. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat
            label="Visits placed"
            value={`${placedVisits.length} / ${visits.length}`}
            sub={`${unplacedVisits.length} unplaced · ${completedVisits.length} completed`}
            tone={unplacedVisits.length > 0 ? 'warning' : 'success'}
          />
          <Stat
            label="Total work hrs"
            value={formatMin(summary.workMin)}
            sub={`${formatMin(summary.driveMin)} drive · ${Math.round(summary.driveMiles)} mi`}
          />
          <Stat
            label="Portfolio utilization"
            value={portfolioUtilization != null ? `${portfolioUtilization}%` : '—'}
            sub={`${idleDayCount} idle/between days`}
            tone={
              portfolioUtilization == null
                ? 'default'
                : portfolioUtilization >= 80
                  ? 'success'
                  : portfolioUtilization >= 60
                    ? 'warning'
                    : 'danger'
            }
          />
          <Stat
            label="Optimization score"
            value={optimizationScore != null ? `${Math.round(optimizationScore)}/100` : '—'}
            tone={optimizationScore != null && optimizationScore >= 80 ? 'success' : 'default'}
          />
        </div>

        {/* Phase 4.4 — pairing + pacing summary */}
        {pacing && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Stat
              label="Pair rate"
              value={`${pacing.pairing_stats?.pair_rate_pct ?? 0}%`}
              sub={`${pacing.pairing_stats?.paired_days ?? 0} paired · ${pacing.pairing_stats?.single_stop_days ?? 0} single`}
              tone={
                (pacing.pairing_stats?.pair_rate_pct ?? 0) >= 40
                  ? 'success'
                  : (pacing.pairing_stats?.pair_rate_pct ?? 0) >= 20
                    ? 'warning'
                    : 'default'
              }
            />
            <Stat
              label="Crew end-day spread"
              value={`${pacing.crew_end_workday_spread ?? 0} days`}
              sub={`target ≤${pacing.target_spread_workdays ?? 10}`}
              tone={
                (pacing.crew_end_workday_spread ?? 0) <= (pacing.target_spread_workdays ?? 10)
                  ? 'success'
                  : 'warning'
              }
            />
            <Stat
              label="Crews used"
              value={String((pacing.per_crew ?? []).length)}
              sub={(pacing.per_crew ?? [])
                .map((p: any) => `${p.crew_label ?? `Crew ${p.crew_index + 1}`}: ${p.pair_rate_pct}% paired`)
                .join(' · ')}
            />
          </div>
        )}

        {pacingWarnings.length > 0 && (
          <div className="space-y-2">
            {pacingWarnings.map((w, i) => (
              <div
                key={i}
                className="rounded-md border border-warning/30 bg-warning-subtle px-3 py-2 text-xs text-fg"
              >
                <span className="font-semibold">⚠ {w.message}</span>
                {(w as any).suggested_action && (
                  <span className="ml-1 text-fg-muted">— {(w as any).suggested_action}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* View switcher content */}
        {view === 'gantt' && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold tracking-tight text-fg">
              Gantt — Crew × day utilization
            </h2>
            <p className="text-xs text-fg-muted">
              Drag a cell to move that day's visits to a different date or crew · Cmd+click to multi-select · L/U lock/unlock · T jumps to today · Cmd+Z to undo
            </p>
            <GanttView
              days={utilDays}
              scrollToToday={todayCounter}
              onCellDrop={handleCellDrop}
              onBulkAction={(action, cells) => {
                const ids = visitsForCells(cells)
                handleBulkAction(action, ids)
              }}
            />
          </div>
        )}

        {view === 'calendar' && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold tracking-tight text-fg">Calendar</h2>
            <p className="text-xs text-fg-muted">
              Month grid showing per-day crew bars. Bar width ≈ utilization. Idle days highlighted yellow.
              Drag a crew bar to a different day to move that crew's visits.
            </p>
            <CalendarView days={utilDays} onCellDrop={handleCellDrop} />
          </div>
        )}

        {view === 'map' && (
          <div className="space-y-2">
            <h2 className="text-base font-semibold tracking-tight text-fg">Map</h2>
            <p className="text-xs text-fg-muted">
              Properties + branches plotted spatially. Drag the scrubber to step through each
              workday in the cycle. Right panel shows per-crew status for the selected date.
            </p>
            <CycleMapView
              visits={visits as any}
              crewDays={crewDays as any}
              utilDays={utilDays}
              branches={branches}
              cycleStart={cycle.start_date}
              cycleEnd={cycle.end_date}
            />
          </div>
        )}

        {/* List view: existing crew_days + visits tables */}
        {view === 'list' && (
        <>
        {/* Crew days */}
        <Card padding="none">
          <div className="border-b border-border px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <CardTitle>Crew days</CardTitle>
            <Button
              size="sm"
              variant="ghost"
              onClick={exportCrewDaysCsv}
              disabled={crewDays.length === 0}
              title="Download per-property drive time as CSV"
            >
              Export CSV
            </Button>
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
                {crewDays.map((cd) => {
                  const route = Array.isArray((cd as any).route) ? (cd as any).route as any[] : []
                  const stopsLabel = route.length === 0
                    ? null
                    : route.length === 1
                      ? (route[0]?.address ?? '').split(',')[0]
                      : `${(route[0]?.address ?? '').split(',')[0]} +${route.length - 1} more`
                  return (
                  <TableRow key={cd.id}>
                    <TableCell className="text-xs font-tabular">{cd.scheduled_date}</TableCell>
                    <TableCell numeric>{cd.crew_index + 1}</TableCell>
                    <TableCell className="text-sm">
                      <div className="font-medium text-fg">
                        {stopsLabel ?? '—'}
                      </div>
                      <div className="text-[11px] text-fg-subtle">
                        {cd.trip_label ?? cd.trip_id}
                        {cd.trip_total_days && cd.trip_total_days > 1
                          ? <span className="ml-1">(day {cd.trip_day_number}/{cd.trip_total_days})</span>
                          : null}
                      </div>
                      {cd.day_type === 'overnight' && cd.start_location?.name && cd.start_location?.type === 'branch' && (
                        <div className="text-[11px] text-fg-subtle">
                          out of {cd.start_location.name}
                        </div>
                      )}
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
                  )
                })}
              </TableBody>
            </Table>
          )}
        </Card>

        {/* Visits */}
        <Card padding="none">
          <div className="border-b border-border px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <CardTitle>Scheduled visits</CardTitle>
              {selectedVisitIds.size > 0 && (
                <span className="text-xs text-fg-muted">
                  · <span className="font-tabular font-medium">{selectedVisitIds.size}</span> selected
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs">
              {selectedVisitIds.size > 0 && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => handleBulkAction('lock', Array.from(selectedVisitIds))}>
                    Lock
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => handleBulkAction('unlock', Array.from(selectedVisitIds))}>
                    Unlock
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => handleBulkAction('mark_complete', Array.from(selectedVisitIds))}>
                    Mark complete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedVisitIds(new Set())}>Clear</Button>
                </>
              )}
              <Button size="sm" variant="ghost" onClick={exportVisitsCsv}>
                Export CSV
              </Button>
            </div>
          </div>
          {visits.length === 0 ? (
            <p className="px-4 py-6 text-sm text-fg-muted">No visits scheduled.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <input
                      type="checkbox"
                      checked={selectedVisitIds.size > 0 && selectedVisitIds.size === visits.length}
                      ref={(el) => {
                        if (el) el.indeterminate = selectedVisitIds.size > 0 && selectedVisitIds.size < visits.length
                      }}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedVisitIds(new Set(visits.map((v) => v.id)))
                        else setSelectedVisitIds(new Set())
                      }}
                      className="rounded border-border accent-accent"
                    />
                  </TableHead>
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
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selectedVisitIds.has(v.id)}
                        onChange={() => {
                          const next = new Set(selectedVisitIds)
                          if (next.has(v.id)) next.delete(v.id)
                          else next.add(v.id)
                          setSelectedVisitIds(next)
                        }}
                        className="rounded border-border accent-accent"
                      />
                    </TableCell>
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
                      {!v.attached_addons || v.attached_addons.length === 0 ? (
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
        </>
        )}
      </div>

      <MoveVisitDialog
        visit={moveTarget}
        onClose={() => setMoveTarget(null)}
        onMoved={() => { setMoveTarget(null); load() }}
      />

      <BulkMoveConfirmDialog
        pending={pendingDrop}
        onClose={() => setPendingDrop(null)}
        onConfirm={async (propagate) => {
          if (!pendingDrop) return
          await handleBulkAction('move', pendingDrop.sourceVisitIds, {
            to_date: pendingDrop.targetDate,
            propagate_to_template: propagate,
          })
          setPendingDrop(null)
        }}
      />

      <HistoryDrawer cycleId={cycleId!} onChange={load} />

      <StatusBar
        cycleName={`Cycle ${cycle.cycle_number}`}
        startDate={cycle.start_date}
        endDate={cycle.end_date}
        visitsPlaced={placedVisits.length}
        visitsTotal={visits.length}
        utilizationPct={portfolioUtilization}
        idleDays={idleDayCount}
        optimizationScore={optimizationScore}
        saveState={saveState}
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

function Stat({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string
  value: string
  sub?: string
  tone?: 'default' | 'success' | 'warning' | 'danger'
}) {
  const toneClass =
    tone === 'success'
      ? 'border-success/40 bg-success/5'
      : tone === 'warning'
        ? 'border-warning/40 bg-warning/5'
        : tone === 'danger'
          ? 'border-danger/40 bg-danger/5'
          : 'border-border bg-surface'
  return (
    <div className={`rounded-md border ${toneClass} px-3 py-2`}>
      <p className="text-[10px] uppercase tracking-wider text-fg-subtle">{label}</p>
      <p className="font-mono text-base font-semibold tabular-nums text-fg leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-fg-muted font-tabular">{sub}</p>}
    </div>
  )
}

function StatLegacy({ label, value, sub }: { label: string; value: string; sub?: string }) {
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

function BulkMoveConfirmDialog({
  pending,
  onClose,
  onConfirm,
}: {
  pending: { sourceVisitIds: string[]; targetDate: string; description: string } | null
  onClose: () => void
  onConfirm: (propagate: boolean) => void
}) {
  const [propagate, setPropagate] = useState(true)
  useEffect(() => { if (pending) setPropagate(true) }, [pending])
  if (!pending) return null
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm move</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>{pending.description}.</p>
          <FormField label="Apply this change to:">
            <div className="space-y-1">
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="radio"
                  checked={propagate}
                  onChange={() => setPropagate(true)}
                  className="mt-0.5 border-border accent-accent"
                />
                <span>
                  <span className="font-medium">This cycle and the template</span> — change repeats in future cycles (default)
                </span>
              </label>
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="radio"
                  checked={!propagate}
                  onChange={() => setPropagate(false)}
                  className="mt-0.5 border-border accent-accent"
                />
                <span>
                  <span className="font-medium">This cycle only</span> — one-time exception
                </span>
              </label>
            </div>
          </FormField>
          <p className="text-xs text-fg-subtle">Cmd+Z to undo.</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onConfirm(propagate)}>
            Move {pending.sourceVisitIds.length}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

