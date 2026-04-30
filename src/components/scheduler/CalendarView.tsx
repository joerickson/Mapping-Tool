// Phase 4f-3 Calendar view — month grid with crew bars per day +
// drag-drop on individual crew bars. Drag a bar from one day to another
// to move that crew's visits.
import { useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react'
import Button from '../ui/Button'
import { cn } from '../../lib/cn'
import type { UtilDay } from './GanttView'

const CREW_COLORS = [
  'bg-indigo-500',
  'bg-teal-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-slate-500',
]

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

interface Props {
  days: UtilDay[]
  onDayClick?: (date: string) => void
  // Drag-drop a crew bar on day A onto day B → move that crew's visits.
  // Same shape as Gantt's onCellDrop.
  onCellDrop?: (drop: {
    source: { crew_index: number; date: string }
    target: { crew_index: number; date: string }
  }) => void
}

export default function CalendarView({ days, onDayClick, onCellDrop }: Props) {
  const dragSource = useRef<{ crew_index: number; date: string } | null>(null)
  const [dragOverDate, setDragOverDate] = useState<string | null>(null)
  const dates = useMemo(() => {
    const set = new Set(days.map((d) => d.scheduled_date))
    return Array.from(set).sort()
  }, [days])

  const [monthIndex, setMonthIndex] = useState(0)

  // Group dates into months for navigation
  const months = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const d of dates) {
      const key = d.slice(0, 7) // YYYY-MM
      const arr = m.get(key) ?? []
      arr.push(d)
      m.set(key, arr)
    }
    return Array.from(m.keys()).sort()
  }, [dates])

  // Build per-date crew bar data
  const cellsByDate = useMemo(() => {
    const map = new Map<string, UtilDay[]>()
    for (const d of days) {
      const arr = map.get(d.scheduled_date) ?? []
      arr.push(d)
      map.set(d.scheduled_date, arr)
    }
    for (const arr of map.values()) arr.sort((a, b) => a.crew_index - b.crew_index)
    return map
  }, [days])

  if (months.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface p-6 text-sm text-fg-muted">
        No crew-days to display. Generate a cycle first.
      </div>
    )
  }

  const currentMonthKey = months[Math.min(monthIndex, months.length - 1)]
  const [year, month] = currentMonthKey.split('-').map(Number)
  // Build 7-col grid for the calendar (Sunday-start). Pad with blanks.
  const firstDay = new Date(Date.UTC(year, month - 1, 1))
  const padBefore = firstDay.getUTCDay()
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const cells: Array<{ date: string | null; dom: number | null }> = []
  for (let i = 0; i < padBefore; i++) cells.push({ date: null, dom: null })
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(Date.UTC(year, month - 1, d)).toISOString().slice(0, 10)
    cells.push({ date: dt, dom: d })
  }
  // Pad to next 7 boundary
  while (cells.length % 7 !== 0) cells.push({ date: null, dom: null })

  return (
    <div className="rounded-md border border-border bg-surface overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 bg-surface-subtle">
        <Button
          size="sm"
          variant="ghost"
          disabled={monthIndex === 0}
          onClick={() => setMonthIndex((i) => Math.max(0, i - 1))}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <p className="text-sm font-semibold text-fg">
          {MONTH_NAMES[month - 1]} {year}
        </p>
        <Button
          size="sm"
          variant="ghost"
          disabled={monthIndex === months.length - 1}
          onClick={() => setMonthIndex((i) => Math.min(months.length - 1, i + 1))}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-7 border-b border-border bg-surface-subtle">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="px-2 py-1 text-[10px] uppercase tracking-wider text-fg-subtle font-semibold text-center">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((c, i) => {
          if (!c.date) {
            return <div key={i} className="border-r border-b border-border bg-surface-subtle/30" style={{ minHeight: 96 }} />
          }
          const cellDays = cellsByDate.get(c.date) ?? []
          const hasIdle = cellDays.some((d) => d.state.kind === 'idle')
          const isDragOver = dragOverDate === c.date
          // Sort: working crews first, idle/between last (so the
          // useful info reads top-down in the cell).
          const sortedCellDays = [...cellDays].sort((a, b) => {
            const order = (k: string) =>
              k === 'idle' || k === 'between_trips' ? 1 : 0
            return order(a.state.kind) - order(b.state.kind) || a.crew_index - b.crew_index
          })
          return (
            <div
              key={c.date}
              onDragOver={(e) => {
                if (dragSource.current && dragSource.current.date !== c.date) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDragOverDate(c.date)
                }
              }}
              onDragLeave={() => {
                if (dragOverDate === c.date) setDragOverDate(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                const src = dragSource.current
                dragSource.current = null
                setDragOverDate(null)
                if (!src || !c.date || src.date === c.date) return
                onCellDrop?.({
                  source: src,
                  target: { crew_index: src.crew_index, date: c.date },
                })
              }}
              onClick={() => onDayClick?.(c.date!)}
              className={cn(
                'border-r border-b border-border p-1.5 text-left flex flex-col gap-0.5 hover:bg-surface-subtle transition-colors cursor-pointer',
                hasIdle && 'bg-warning/5',
                isDragOver && 'ring-2 ring-warning ring-inset'
              )}
              style={{ minHeight: 110 }}
            >
              <p className="text-xs font-tabular text-fg-muted">{c.dom}</p>
              {sortedCellDays.map((d) => {
                const isIdle = d.state.kind === 'idle' || d.state.kind === 'between_trips'
                const draggable = !isIdle
                const label = isIdle
                  ? d.state.kind === 'idle' ? 'idle' : 'between'
                  : d.trip_label ?? '—'
                return (
                  <div
                    key={d.crew_index}
                    draggable={draggable}
                    onDragStart={(e) => {
                      if (!draggable) return
                      e.stopPropagation()
                      dragSource.current = { crew_index: d.crew_index, date: d.scheduled_date }
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', `${d.crew_index}|${d.scheduled_date}`)
                    }}
                    onDragEnd={() => {
                      dragSource.current = null
                      setDragOverDate(null)
                    }}
                    className={cn(
                      'flex items-center gap-1 text-[10px] leading-tight rounded px-1 py-0.5',
                      isIdle
                        ? 'bg-danger/10 text-danger'
                        : 'bg-surface-subtle hover:bg-surface',
                      d.state.kind === 'partial' && 'opacity-80',
                      draggable && 'cursor-grab'
                    )}
                    title={`${d.crew_label}: ${d.work_hours_scheduled.toFixed(1)}h · ${d.state.kind}${draggable ? ' (drag to move)' : ''}`}
                  >
                    <span
                      className={cn(
                        'h-2 w-2 rounded-full shrink-0',
                        isIdle ? 'bg-danger/60' : CREW_COLORS[d.crew_index % CREW_COLORS.length]
                      )}
                    />
                    <span className="truncate flex-1 font-medium text-fg">{label}</span>
                    {!isIdle && (
                      <span className="font-tabular text-fg-muted shrink-0">
                        {d.work_hours_scheduled.toFixed(1)}h
                      </span>
                    )}
                  </div>
                )
              })}
              {hasIdle && (
                <div className="text-[9px] text-danger/70 flex items-center gap-1 mt-auto pt-0.5">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  {cellDays.filter((d) => d.state.kind === 'idle').length} idle
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
