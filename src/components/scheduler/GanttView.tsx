// Phase 4f-2 Gantt view — color-coded crew × day grid with drag-drop
// (cell → cell moves the day's visits) + multi-select (Cmd/Ctrl click)
// + keyboard shortcuts (T jumps to today; L/U lock/unlock selected;
// Esc clears; Cmd+A selects all visible).
//
// Each cell represents one (crew, day). Dragging a cell moves all
// visits scheduled to that day to the target's date and crew. Per-
// visit drag would need an expanded interaction; ships in 4f-3.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
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
  // Phase 4f-4 — what the crew is actually visiting that day. Filled
  // from crew_day_routes.route by the crew-utilization endpoint.
  property_count?: number
  property_summary?: string | null
  property_addresses?: string[]
}

export interface DropTarget {
  source: { crew_index: number; date: string }
  target: { crew_index: number; date: string }
}

interface Props {
  days: UtilDay[]
  onCellClick?: (day: UtilDay) => void
  onCellDrop?: (drop: DropTarget) => void
  onBulkAction?: (action: 'lock' | 'unlock', cells: Array<{ crew_index: number; date: string }>) => void
  scrollToToday?: number // a counter; when it changes, scroll to today
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

type CellKey = string
const cellKey = (c: number, d: string): CellKey => `${c}|${d}`
const parseCellKey = (k: CellKey): { crew_index: number; date: string } => {
  const [c, d] = k.split('|')
  return { crew_index: Number(c), date: d }
}

export default function GanttView({
  days,
  onCellClick,
  onCellDrop,
  onBulkAction,
  scrollToToday,
}: Props) {
  const [selected, setSelected] = useState<Set<CellKey>>(new Set())
  // Phase 4f-4 — filter chips for the legend. Empty Set = no filter
  // (all kinds visible). Add a kind to mute cells of that kind.
  const [hiddenKinds, setHiddenKinds] = useState<Set<CrewDayStateKind>>(new Set())
  const toggleKind = (kind: CrewDayStateKind) => {
    setHiddenKinds((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }
  const [dragOver, setDragOver] = useState<CellKey | null>(null)
  const dragSource = useRef<CellKey | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

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

  // Scroll to today when triggered.
  useEffect(() => {
    if (!scrollToToday || !containerRef.current) return
    const today = new Date().toISOString().slice(0, 10)
    const idx = allDates.findIndex((d) => d >= today)
    if (idx === -1) return
    const cellEl = containerRef.current.querySelector<HTMLElement>(
      `[data-date="${allDates[idx]}"]`
    )
    if (cellEl) cellEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [scrollToToday, allDates])

  // Keyboard: Esc clears, Cmd+A selects all "with-work" cells, L/U bulk.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement
      if (tgt?.tagName === 'INPUT' || tgt?.tagName === 'TEXTAREA' || tgt?.isContentEditable) return
      const meta = e.metaKey || e.ctrlKey
      if (e.key === 'Escape') {
        setSelected(new Set())
        return
      }
      if (meta && e.key === 'a') {
        e.preventDefault()
        const next = new Set<CellKey>()
        for (const crew of crews) {
          for (const [date, d] of crew.cells) {
            if (d.state.kind !== 'idle' && d.state.kind !== 'between_trips') {
              next.add(cellKey(crew.index, date))
            }
          }
        }
        setSelected(next)
        return
      }
      if (selected.size > 0 && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault()
        onBulkAction?.('lock', Array.from(selected).map(parseCellKey))
        setSelected(new Set())
      } else if (selected.size > 0 && (e.key === 'u' || e.key === 'U')) {
        e.preventDefault()
        onBulkAction?.('unlock', Array.from(selected).map(parseCellKey))
        setSelected(new Set())
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [crews, selected, onBulkAction])

  if (crews.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface p-6 text-sm text-fg-muted">
        No crew-days to display. Generate a cycle first.
      </div>
    )
  }

  return (
    <div className="rounded-md border border-border bg-surface overflow-hidden">
      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 border-b border-accent/40 bg-accent/10 px-4 py-2 text-sm">
          <span>
            <span className="font-tabular font-medium">{selected.size}</span> day{selected.size === 1 ? '' : 's'} selected
          </span>
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => {
                onBulkAction?.('lock', Array.from(selected).map(parseCellKey))
                setSelected(new Set())
              }}
              className="rounded border border-border bg-surface px-2 py-1 hover:bg-surface-subtle"
            >
              Lock (L)
            </button>
            <button
              type="button"
              onClick={() => {
                onBulkAction?.('unlock', Array.from(selected).map(parseCellKey))
                setSelected(new Set())
              }}
              className="rounded border border-border bg-surface px-2 py-1 hover:bg-surface-subtle"
            >
              Unlock (U)
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-fg-muted hover:text-fg"
            >
              Clear (Esc)
            </button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto" ref={containerRef}>
        <table className="border-collapse min-w-full">
          <thead>
            <tr className="bg-surface-subtle">
              <th
                // Inline opaque background + bumped z-index so cells
                // can't scroll through. border-collapse + sticky + rowSpan
                // produces a known browser bug where Tailwind's bg-* on
                // a sticky table cell paints transparently in some
                // engines; the inline style guarantees a solid color.
                style={{
                  backgroundColor: 'var(--color-bg-subtle, #fafafa)',
                  backgroundClip: 'padding-box',
                }}
                className="sticky left-0 z-20 border-b border-r border-border px-3 py-2 text-left text-[10px] uppercase tracking-wider text-fg-subtle font-semibold"
              >
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
              // Build a "trip ribbon" — consecutive same-trip days collapse
              // into one cell so the user can read the location without
              // hovering. Cells with no trip get their own narrow td.
              // Per-day property label. Merge consecutive days with the
              // exact same property_summary so multi-day overnight stays
              // collapse into one cell. trip_label is kept only as the
              // hover tooltip — the user wanted to see WHICH PROPERTY
              // the crew is on each day, not the cluster name.
              const ribbon: Array<{
                colSpan: number
                label: string | null
                tooltip: string | null
                trip_id: string | null
              }> = []
              let k = 0
              while (k < allDates.length) {
                const c = crew.cells.get(allDates[k])
                const summary = c?.property_summary ?? null
                if (!summary) {
                  ribbon.push({ colSpan: 1, label: null, tooltip: null, trip_id: null })
                  k++
                  continue
                }
                let j = k
                while (
                  j < allDates.length &&
                  (crew.cells.get(allDates[j])?.property_summary ?? null) === summary
                ) j++
                const tooltipParts: string[] = []
                if (c?.property_addresses && c.property_addresses.length > 0) {
                  tooltipParts.push(c.property_addresses.join('\n'))
                }
                if (c?.trip_label) tooltipParts.push(`Cluster: ${c.trip_label}`)
                ribbon.push({
                  colSpan: j - k,
                  label: summary,
                  tooltip: tooltipParts.join('\n\n') || null,
                  trip_id: c?.trip_id ?? null,
                })
                k = j
              }
              return (
                <Fragment key={crew.index}>
                <tr>
                  <th
                    rowSpan={2}
                    className="sticky left-0 z-20 border-b border-r border-border px-3 py-2 text-left whitespace-nowrap align-top"
                    // Inline opaque background — see Crew header note.
                    // Without this, the rowSpan'd sticky cell's bg-surface
                    // class doesn't paint reliably and the day cells in
                    // row 2 visibly scroll under the crew label.
                    style={{
                      minWidth: 180,
                      backgroundColor: 'var(--color-bg, #ffffff)',
                      backgroundClip: 'padding-box',
                    }}
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
                  {ribbon.map((seg, si) => (
                    <td
                      key={si}
                      colSpan={seg.colSpan}
                      className={cn(
                        'border-b border-border text-[11px] text-fg-muted px-1 py-0.5 truncate',
                        seg.label && 'bg-surface-subtle font-medium text-fg'
                      )}
                      title={seg.tooltip ?? seg.label ?? ''}
                      style={{ height: 18, minWidth: 28 }}
                    >
                      {seg.label ?? ''}
                    </td>
                  ))}
                </tr>
                <tr>
                  {allDates.map((d) => {
                    const cell = crew.cells.get(d)
                    if (!cell) {
                      return (
                        <td
                          key={d}
                          data-date={d}
                          className="border-b border-border bg-surface-subtle/30"
                          style={{ minWidth: 28, height: 36 }}
                        />
                      )
                    }
                    const key = cellKey(crew.index, d)
                    const isSelected = selected.has(key)
                    const draggable = cell.state.kind !== 'idle' && cell.state.kind !== 'between_trips'
                    const isDragOver = dragOver === key
                    return (
                      <td
                        key={d}
                        data-date={d}
                        draggable={draggable}
                        onDragStart={(e) => {
                          if (!draggable) return
                          dragSource.current = key
                          e.dataTransfer.effectAllowed = 'move'
                          e.dataTransfer.setData('text/plain', key)
                        }}
                        onDragOver={(e) => {
                          if (dragSource.current && dragSource.current !== key) {
                            e.preventDefault()
                            e.dataTransfer.dropEffect = 'move'
                            setDragOver(key)
                          }
                        }}
                        onDragLeave={() => {
                          if (dragOver === key) setDragOver(null)
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          const src = dragSource.current
                          dragSource.current = null
                          setDragOver(null)
                          if (!src || src === key) return
                          onCellDrop?.({
                            source: parseCellKey(src),
                            target: parseCellKey(key),
                          })
                        }}
                        onDragEnd={() => {
                          dragSource.current = null
                          setDragOver(null)
                        }}
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey) {
                            const next = new Set(selected)
                            if (next.has(key)) next.delete(key)
                            else next.add(key)
                            setSelected(next)
                          } else {
                            onCellClick?.(cell)
                          }
                        }}
                        className={cn(
                          'border-b border-border cursor-pointer transition-all',
                          stateClass(cell.state.kind),
                          isSelected && 'ring-2 ring-accent ring-inset',
                          isDragOver && 'ring-2 ring-warning ring-inset opacity-70',
                          draggable && 'cursor-grab',
                          hiddenKinds.has(cell.state.kind) && 'opacity-15 grayscale'
                        )}
                        style={{ minWidth: 28, height: 36 }}
                        title={`${cell.crew_label} · ${cell.scheduled_date}\n${cell.work_hours_scheduled.toFixed(1)}h · ${cell.utilization_pct}%${cell.trip_label ? `\n${cell.trip_label}` : ''}\nCmd+click to select; drag to move`}
                      >
                        <div className="flex items-center justify-center h-full">
                          <StateIcon kind={cell.state.kind} className="opacity-60" />
                        </div>
                      </td>
                    )
                  })}
                </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border bg-surface-subtle px-3 py-2 text-xs text-fg-muted flex items-center gap-2 flex-wrap">
        <span className="text-fg-subtle mr-1">Filter:</span>
        {(
          [
            { kinds: ['fully_utilized'] as const, label: 'Full', dot: 'bg-indigo-600' },
            { kinds: ['partial'] as const, label: 'Partial', dot: 'bg-indigo-200 border border-indigo-300' },
            { kinds: ['idle'] as const, label: 'Idle', dot: 'bg-red-100 border border-red-300' },
            { kinds: ['between_trips'] as const, label: 'Between', dot: 'bg-zinc-200 border border-zinc-300' },
            { kinds: ['travel_day'] as const, label: 'Travel', dot: 'bg-amber-200 border border-amber-400' },
            { kinds: ['overnight_continuation'] as const, label: 'Overnight', dot: 'bg-indigo-500' },
          ] as Array<{ kinds: readonly CrewDayStateKind[]; label: string; dot: string }>
        ).map((chip) => {
          const allHidden = chip.kinds.every((k) => hiddenKinds.has(k))
          return (
            <button
              key={chip.label}
              type="button"
              onClick={() => {
                setHiddenKinds((prev) => {
                  const next = new Set(prev)
                  if (allHidden) for (const k of chip.kinds) next.delete(k)
                  else for (const k of chip.kinds) next.add(k)
                  return next
                })
              }}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors',
                allHidden
                  ? 'border-border text-fg-subtle line-through opacity-60'
                  : 'border-border-strong text-fg hover:bg-surface'
              )}
            >
              <span className={cn('inline-block h-2.5 w-2.5 rounded', chip.dot)} />
              {chip.label}
            </button>
          )
        })}
        {hiddenKinds.size > 0 && (
          <button
            type="button"
            onClick={() => setHiddenKinds(new Set())}
            className="text-accent hover:underline"
          >
            Clear filters
          </button>
        )}
        <span className="ml-auto text-fg-subtle">
          Cmd+click to select · drag to move · T jumps to today
        </span>
      </div>
    </div>
  )
}
