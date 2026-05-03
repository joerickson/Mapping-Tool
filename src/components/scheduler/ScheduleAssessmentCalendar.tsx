// Calendar view for an uploaded schedule assessment. Month grid where
// each day cell shows visit count + total square footage so the
// operator can tell at a glance which days are heavy by *footprint*
// (one big building → maybe one crew can absorb it) vs heavy by
// *count* (many small buildings → potentially needs a second crew).
//
// Click a day to expand a list of properties for that day with their
// individual sqft. Sqft is also reflected as a color heat scale on
// the cell itself relative to the busiest day in the upload.
import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Button from '../ui/Button'
import { cn } from '../../lib/cn'

export interface CalendarVisit {
  row_id: string
  sl_id: string | null
  display_name: string | null
  address: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  crew_name: string | null
  sqft: number | null
  lat: number | null
  lng: number | null
}
export interface CalendarDay {
  date: string
  dow: string
  visits: CalendarVisit[]
  total_sqft: number
  visit_count: number
  distinct_crews: number
}
export interface CalendarSummary {
  start_date: string | null
  end_date: string | null
  day_count: number
  visit_count: number
  implausible_date_count?: number
  total_sqft: number
  max_daily_sqft: number
  max_daily_visits: number
}

interface Props {
  days: CalendarDay[]
  summary: CalendarSummary
  // Save a corrected date on a single row. Parent wires this to the
  // rows PATCH endpoint; the component handles UI state. Returns
  // whatever the server returned so the caller can decide whether to
  // refetch the calendar.
  onEditDate?: (rowId: string, newDate: string) => Promise<void>
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function fmtSqft(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return `${n}`
}

export default function ScheduleAssessmentCalendar({ days, summary, onEditDate }: Props) {
  const [editingRowId, setEditingRowId] = useState<string | null>(null)
  const [editingDate, setEditingDate] = useState<string>('')
  const [savingDate, setSavingDate] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const dayByDate = useMemo(() => {
    const m = new Map<string, CalendarDay>()
    for (const d of days) m.set(d.date, d)
    return m
  }, [days])

  const months = useMemo(() => {
    const set = new Set<string>()
    for (const d of days) set.add(d.date.slice(0, 7))
    return Array.from(set).sort()
  }, [days])

  const [monthIndex, setMonthIndex] = useState(0)
  const [expandedDate, setExpandedDate] = useState<string | null>(null)

  if (months.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface p-6 text-sm text-fg-muted">
        No matched rows with scheduled dates yet.
      </div>
    )
  }

  const currentMonthKey = months[Math.min(monthIndex, months.length - 1)]
  const [year, month] = currentMonthKey.split('-').map(Number)
  const firstDay = new Date(Date.UTC(year, month - 1, 1))
  const padBefore = firstDay.getUTCDay()
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const cells: Array<{ date: string | null; dom: number | null }> = []
  for (let i = 0; i < padBefore; i++) cells.push({ date: null, dom: null })
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(Date.UTC(year, month - 1, d)).toISOString().slice(0, 10)
    cells.push({ date: dt, dom: d })
  }
  while (cells.length % 7 !== 0) cells.push({ date: null, dom: null })

  const expanded = expandedDate ? dayByDate.get(expandedDate) ?? null : null

  // Heat scale based on sqft relative to the cycle's busiest day. Steps
  // approximate quartiles so the worst day stands out.
  const heatClass = (sqft: number): string => {
    if (sqft <= 0 || summary.max_daily_sqft <= 0) return ''
    const ratio = sqft / summary.max_daily_sqft
    if (ratio >= 0.85) return 'bg-rose-500/15 border-rose-400/50'
    if (ratio >= 0.6) return 'bg-amber-500/15 border-amber-400/50'
    if (ratio >= 0.35) return 'bg-yellow-500/10 border-yellow-400/40'
    return 'bg-emerald-500/10 border-emerald-400/30'
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="rounded-md border border-border bg-surface-subtle px-3 py-2">
          <p className="text-fg-muted uppercase tracking-wide">Workdays</p>
          <p className="text-base font-semibold text-fg font-tabular">{summary.day_count}</p>
        </div>
        <div className="rounded-md border border-border bg-surface-subtle px-3 py-2">
          <p className="text-fg-muted uppercase tracking-wide">Total visits</p>
          <p className="text-base font-semibold text-fg font-tabular">{summary.visit_count}</p>
        </div>
        <div className="rounded-md border border-border bg-surface-subtle px-3 py-2">
          <p className="text-fg-muted uppercase tracking-wide">Total sqft</p>
          <p className="text-base font-semibold text-fg font-tabular">{fmtSqft(summary.total_sqft)}</p>
        </div>
        <div className="rounded-md border border-border bg-surface-subtle px-3 py-2">
          <p className="text-fg-muted uppercase tracking-wide">Peak day</p>
          <p className="text-base font-semibold text-fg font-tabular">
            {summary.max_daily_visits} visits · {fmtSqft(summary.max_daily_sqft)}
          </p>
        </div>
      </div>

      <div className="rounded-md border border-border bg-surface overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-3 py-2 bg-surface-subtle">
          <Button
            size="sm"
            variant="ghost"
            disabled={monthIndex === 0}
            onClick={() => setMonthIndex((i) => Math.max(0, i - 1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <p className="text-sm font-medium text-fg">
            {MONTH_NAMES[month - 1]} {year}
          </p>
          <Button
            size="sm"
            variant="ghost"
            disabled={monthIndex >= months.length - 1}
            onClick={() => setMonthIndex((i) => Math.min(months.length - 1, i + 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div className="grid grid-cols-7 border-b border-border bg-surface-subtle text-[10px] text-fg-muted uppercase tracking-wide">
          {DOW_LABELS.map((d) => (
            <div key={d} className="px-2 py-1 text-center">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((c, i) => {
            const day = c.date ? dayByDate.get(c.date) : null
            const isExpanded = !!day && expandedDate === c.date
            return (
              <button
                key={i}
                type="button"
                disabled={!day}
                onClick={() => day && setExpandedDate(isExpanded ? null : c.date)}
                className={cn(
                  'min-h-[78px] border-b border-r border-border p-1.5 text-left text-xs transition-colors',
                  !c.date && 'bg-surface-subtle/40',
                  day && heatClass(day.total_sqft),
                  day && 'hover:bg-surface-muted/60 cursor-pointer',
                  isExpanded && 'ring-2 ring-accent ring-inset'
                )}
              >
                {c.dom && (
                  <div className="text-fg-muted text-[10px] font-tabular">{c.dom}</div>
                )}
                {day && (
                  <div className="space-y-0.5 mt-0.5">
                    <p className="text-fg font-medium font-tabular">
                      {day.visit_count} visit{day.visit_count === 1 ? '' : 's'}
                    </p>
                    <p className="text-fg-muted font-tabular">
                      {day.total_sqft > 0 ? fmtSqft(day.total_sqft) + ' sqft' : '—'}
                    </p>
                    {day.distinct_crews > 0 && (
                      <p className="text-fg-subtle text-[10px]">
                        {day.distinct_crews} crew{day.distinct_crews === 1 ? '' : 's'}
                      </p>
                    )}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {expanded && (
        <div className="rounded-md border border-border bg-surface p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-fg">
              {expanded.dow} {expanded.date} — {expanded.visit_count} visit
              {expanded.visit_count === 1 ? '' : 's'}
              {expanded.total_sqft > 0 ? ` · ${fmtSqft(expanded.total_sqft)} sqft` : ''}
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExpandedDate(null)}
            >
              Close
            </Button>
          </div>
          <ul className="divide-y divide-border">
            {expanded.visits.map((v) => {
              const cityState = [v.city, v.state, v.postal_code].filter(Boolean).join(', ')
              const isEditing = editingRowId === v.row_id
              return (
                <li key={v.row_id} className="py-2 flex items-start gap-3 text-xs">
                  <span className="font-tabular text-fg-muted shrink-0 w-24 text-right pt-0.5">
                    {v.sqft != null ? fmtSqft(v.sqft) + ' sqft' : '—'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-fg truncate">
                      {v.address ?? v.display_name ?? '(unnamed)'}
                    </p>
                    {cityState && (
                      <p className="text-fg-muted truncate">{cityState}</p>
                    )}
                    {isEditing && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <input
                          type="date"
                          value={editingDate}
                          onChange={(e) => setEditingDate(e.target.value)}
                          className="h-7 rounded border border-border bg-surface px-2 text-xs"
                          autoFocus
                        />
                        <Button
                          size="sm"
                          loading={savingDate}
                          disabled={!editingDate || savingDate}
                          onClick={async () => {
                            if (!onEditDate) return
                            setEditError(null)
                            setSavingDate(true)
                            try {
                              await onEditDate(v.row_id, editingDate)
                              setEditingRowId(null)
                            } catch (e) {
                              setEditError(e instanceof Error ? e.message : String(e))
                            } finally {
                              setSavingDate(false)
                            }
                          }}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={savingDate}
                          onClick={() => {
                            setEditingRowId(null)
                            setEditError(null)
                          }}
                        >
                          Cancel
                        </Button>
                        {editError && <span className="text-danger">{editError}</span>}
                      </div>
                    )}
                  </div>
                  {v.crew_name && !isEditing && (
                    <span className="text-fg-subtle shrink-0 pt-0.5">{v.crew_name}</span>
                  )}
                  {onEditDate && !isEditing && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingRowId(v.row_id)
                        setEditingDate(expanded.date)
                        setEditError(null)
                      }}
                      className="shrink-0"
                    >
                      Edit date
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
