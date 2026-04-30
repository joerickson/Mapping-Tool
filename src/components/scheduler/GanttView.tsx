// Phase 4f-1 MVP Gantt view — color-coded crew × day grid.
// Drag-drop, multi-select, keyboard shortcuts ship in 4f-2.
import { useMemo } from 'react'
import { stateClass, StateIcon, type CrewDayStateKind } from './CrewUtilizationChip'
import { cn } from '../../lib/cn'

export interface UtilDay {
  crew_index: number
  crew_label: string
  scheduled_date: string
  state: { kind: CrewDayStateKind; work_hours: number; unused_hours: number }
  work_hours_scheduled: number
  work_hours_capacity: number
  utilization_pct: number
  trip_id: string | null
  trip_label: string | null
}

interface Props {
  days: UtilDay[]
  onCellClick?: (day: UtilDay) => void
}

const CREW_COLORS = [
  'bg-indigo-500',
  'bg-teal-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-slate-500',
]

export default function GanttView({ days, onCellClick }: Props) {
  // Group by crew, sort dates ascending. Build a sparse 2D grid keyed
  // by crew_index → { date → day }.
  const { crews, allDates } = useMemo(() => {
    const crewMap = new Map<number, { label: string; cells: Map<string, UtilDay> }>()
    const dateSet = new Set<string>()
    for (const d of days) {
      const slot = crewMap.get(d.crew_index) ?? { label: d.crew_label, cells: new Map() }
      slot.cells.set(d.scheduled_date, d)
      crewMap.set(d.crew_index, slot)
      dateSet.add(d.scheduled_date)
    }
    const crews = Array.from(crewMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([i, v]) => ({ index: i, label: v.label, cells: v.cells }))
    const allDates = Array.from(dateSet).sort()
    return { crews, allDates }
  }, [days])

  // Per-crew totals
  const crewSummaries = useMemo(() => {
    return crews.map((c) => {
      const arr = Array.from(c.cells.values())
      const idle = arr.filter((d) => d.state.kind === 'idle').length
      const partial = arr.filter((d) => d.state.kind === 'partial').length
      const between = arr.filter((d) => d.state.kind === 'between_trips').length
      const fullDays = arr.filter((d) => d.state.kind === 'fully_utilized' || d.state.kind === 'overnight_continuation').length
      const totalHours = arr.reduce((s, d) => s + d.work_hours_scheduled, 0)
      const totalCapacity = arr.reduce((s, d) => s + d.work_hours_capacity, 0)
      const util = totalCapacity > 0 ? Math.round((totalHours / totalCapacity) * 100) : 0
      return { idle, partial, between, fullDays, totalHours, util }
    })
  }, [crews])

  if (crews.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface p-6 text-sm text-fg-muted">
        No crew-days to display. Generate a cycle first.
      </div>
    )
  }

  return (
    <div className="rounded-md border border-border bg-surface overflow-hidden">
      <div className="overflow-x-auto">
        <table className="border-collapse min-w-full">
          <thead>
            <tr className="bg-surface-subtle">
              <th className="sticky left-0 z-10 bg-surface-subtle border-b border-r border-border px-3 py-2 text-left text-[10px] uppercase tracking-wider text-fg-subtle font-semibold">
                Crew
              </th>
              {allDates.map((d) => {
                const dt = new Date(d + 'T00:00:00Z')
                const isMonday = dt.getUTCDay() === 1
                return (
                  <th
                    key={d}
                    className={cn(
                      'border-b border-border px-1 py-1 text-[9px] text-fg-subtle font-mono whitespace-nowrap',
                      isMonday && 'border-l border-border-strong'
                    )}
                    style={{ minWidth: 28 }}
                  >
                    {dt.getUTCDate()}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {crews.map((crew, ci) => {
              const summary = crewSummaries[ci]
              return (
                <tr key={crew.index}>
                  <th
                    className="sticky left-0 z-10 bg-surface border-b border-r border-border px-3 py-2 text-left whitespace-nowrap"
                    style={{ minWidth: 180 }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'h-2.5 w-2.5 rounded-full',
                          CREW_COLORS[ci % CREW_COLORS.length]
                        )}
                      />
                      <div>
                        <p className="text-sm font-medium text-fg">{crew.label}</p>
                        <p className="text-[10px] text-fg-muted font-mono">
                          {summary.util}% · {summary.idle}I {summary.partial}P {summary.between}B
                        </p>
                      </div>
                    </div>
                  </th>
                  {allDates.map((d) => {
                    const cell = crew.cells.get(d)
                    if (!cell) {
                      return (
                        <td
                          key={d}
                          className="border-b border-border bg-surface-subtle/30"
                          style={{ minWidth: 28, height: 36 }}
                        />
                      )
                    }
                    return (
                      <td
                        key={d}
                        className={cn(
                          'border-b border-border cursor-pointer transition-opacity hover:opacity-80',
                          stateClass(cell.state.kind)
                        )}
                        style={{ minWidth: 28, height: 36 }}
                        title={`${cell.crew_label} · ${cell.scheduled_date}\n${cell.work_hours_scheduled.toFixed(1)}h · ${cell.utilization_pct}%${cell.trip_label ? `\n${cell.trip_label}` : ''}`}
                        onClick={() => onCellClick?.(cell)}
                      >
                        <div className="flex items-center justify-center h-full">
                          <StateIcon kind={cell.state.kind} className="opacity-60" />
                        </div>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border bg-surface-subtle px-3 py-2 text-xs text-fg-muted flex items-center gap-4 flex-wrap">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-accent/90" /> Full
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-accent/40" /> Partial
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-danger/15 border border-danger/30" /> Idle
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-fg-subtle/15 border border-fg-subtle/20" /> Between
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-warning/30 border border-warning/40" /> Travel
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-accent/70" /> Overnight
        </span>
      </div>
    </div>
  )
}
