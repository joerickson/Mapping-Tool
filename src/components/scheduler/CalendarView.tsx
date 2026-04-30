// Phase 4f-1 MVP Calendar view — month grid with crew bars per day.
// Drag-drop ships in 4f-2.
import { useMemo } from 'react'
import { ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react'
import { useState } from 'react'
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
}

export default function CalendarView({ days, onDayClick }: Props) {
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
          return (
            <button
              key={c.date}
              type="button"
              onClick={() => onDayClick?.(c.date!)}
              className={cn(
                'border-r border-b border-border p-1.5 text-left flex flex-col gap-1 hover:bg-surface-subtle transition-colors',
                hasIdle && 'bg-warning/5'
              )}
              style={{ minHeight: 96 }}
            >
              <p className="text-xs font-tabular text-fg-muted">{c.dom}</p>
              {cellDays.map((d) => {
                const pct = d.utilization_pct
                const isIdle = d.state.kind === 'idle' || d.state.kind === 'between_trips'
                return (
                  <div
                    key={d.crew_index}
                    className={cn(
                      'h-1.5 rounded-sm',
                      isIdle ? 'bg-fg-subtle/30' : CREW_COLORS[d.crew_index % CREW_COLORS.length],
                      d.state.kind === 'partial' && 'opacity-50'
                    )}
                    style={{ width: `${Math.max(10, pct)}%` }}
                    title={`${d.crew_label}: ${d.work_hours_scheduled.toFixed(1)}h · ${d.state.kind}`}
                  />
                )
              })}
              {hasIdle && (
                <div className="text-[10px] text-danger flex items-center gap-1 mt-auto">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  {cellDays.filter((d) => d.state.kind === 'idle').length} idle
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
