// Cycle utilization analyzer — surfaces idle days per home branch with
// streak detection ("blocks" vs "scattered"). Two-column layout:
//   left  = per-branch rollup table
//   right = drill-down to crews homed at the selected branch, each
//           with a date strip showing busy vs idle days.
//
// The endpoint /api/scheduler/cycles/[id]/idle-analysis does the math;
// this component renders.
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { Card, CardTitle } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { cn } from '../../lib/cn'

interface IdleStreak {
  start_date: string
  end_date: string
  length: number
}

interface CrewSummary {
  crew_index: number
  crew_label: string
  home_branch_index: number | null
  home_branch_name: string | null
  workdays_total: number
  idle_days: number
  busy_days: number
  utilization_pct: number
  streaks: IdleStreak[]
  longest_streak: number
  pattern: 'blocks' | 'scattered' | 'mixed' | 'none'
}

interface BranchSummary {
  branch_index: number | null
  branch_name: string
  crew_count: number
  workdays_total: number
  idle_days_total: number
  busy_days_total: number
  utilization_pct: number
  streak_count: number
  longest_streak: number
  pattern: 'blocks' | 'scattered' | 'mixed' | 'none'
  crew_indices: number[]
}

interface IdleAnalysis {
  cycle_id: string
  cycle_start: string
  cycle_end: string
  portfolio: {
    crew_count: number
    workdays_total: number
    idle_days_total: number
    utilization_pct: number
    longest_streak: number
  }
  by_branch: BranchSummary[]
  by_crew: CrewSummary[]
}

const PATTERN_TIPS: Record<BranchSummary['pattern'], string> = {
  blocks: 'Idle days cluster into multi-day blocks — could absorb a multi-day overnight trip from elsewhere.',
  scattered: 'Idle days are mostly single days — typical for unpaired small properties; consider in-day pairing rules.',
  mixed: 'Mix of single-day idles and small blocks.',
  none: 'No idle days detected.',
}

const PATTERN_BADGE: Record<BranchSummary['pattern'], 'success' | 'warning' | 'accent' | 'outline'> = {
  blocks: 'warning',
  scattered: 'accent',
  mixed: 'accent',
  none: 'success',
}

export default function UtilizationPanel({ cycleId }: { cycleId: string }) {
  const { getToken } = useAuth()
  const [data, setData] = useState<IdleAnalysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedBranchKey, setSelectedBranchKey] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const token = await getToken()
        const res = await fetch(`/api/scheduler/cycles/${cycleId}/idle-analysis`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error(`Load failed (${res.status})`)
        const j = (await res.json()) as IdleAnalysis
        if (!cancelled) {
          setData(j)
          if (j.by_branch.length > 0 && !selectedBranchKey) {
            setSelectedBranchKey(branchKey(j.by_branch[0]))
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [cycleId, getToken])

  const days = useMemo(() => {
    if (!data) return [] as string[]
    const out: string[] = []
    const start = new Date(data.cycle_start + 'T00:00:00Z')
    const end = new Date(data.cycle_end + 'T00:00:00Z')
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const dow = d.getUTCDay()
      if (dow === 0 || dow === 6) continue
      out.push(d.toISOString().slice(0, 10))
    }
    return out
  }, [data])

  const selectedBranch = useMemo(() => {
    if (!data || !selectedBranchKey) return null
    return data.by_branch.find((b) => branchKey(b) === selectedBranchKey) ?? null
  }, [data, selectedBranchKey])

  const selectedCrews = useMemo(() => {
    if (!data || !selectedBranch) return []
    const ids = new Set(selectedBranch.crew_indices)
    return data.by_crew.filter((c) => ids.has(c.crew_index))
  }, [data, selectedBranch])

  if (loading) return <p className="text-sm text-fg-muted">Computing utilization…</p>
  if (error) return <p className="text-sm text-danger">{error}</p>
  if (!data) return null

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <CardTitle>Cycle utilization</CardTitle>
            <p className="text-xs text-fg-subtle mt-1">
              {data.cycle_start} → {data.cycle_end} · {data.portfolio.crew_count} crews ·{' '}
              {data.portfolio.workdays_total} workdays total
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <Stat label="Utilization" value={`${data.portfolio.utilization_pct}%`} />
            <Stat label="Idle days" value={data.portfolio.idle_days_total.toString()} />
            <Stat label="Longest idle run" value={`${data.portfolio.longest_streak} day${data.portfolio.longest_streak === 1 ? '' : 's'}`} />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Per-branch rollup */}
        <Card padding="none" className="lg:col-span-2 overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <CardTitle>By home branch</CardTitle>
            <p className="text-xs text-fg-subtle mt-0.5">
              Click a row to drill down. Branches with the most idle days are
              listed first.
            </p>
          </div>
          <div className="divide-y divide-border">
            {data.by_branch.map((b) => {
              const key = branchKey(b)
              const isSel = key === selectedBranchKey
              return (
                <button
                  type="button"
                  key={key}
                  onClick={() => setSelectedBranchKey(key)}
                  className={cn(
                    'w-full px-4 py-3 text-left transition-colors',
                    isSel ? 'bg-accent-subtle/50' : 'hover:bg-surface-subtle/40'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-fg truncate">{b.branch_name}</span>
                    <Badge variant={PATTERN_BADGE[b.pattern]} className="text-[10px]">
                      {b.pattern}
                    </Badge>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-fg-muted">
                    <span>
                      <span className="font-tabular text-fg">{b.crew_count}</span> crews
                    </span>
                    <span>
                      <span className="font-tabular text-fg">{b.idle_days_total}</span> idle
                    </span>
                    {b.longest_streak > 0 && (
                      <span>
                        longest{' '}
                        <span className="font-tabular text-fg">{b.longest_streak}</span>d
                      </span>
                    )}
                    <span className="ml-auto font-tabular text-fg">
                      {b.utilization_pct}%
                    </span>
                  </div>
                  <UtilizationBar
                    busy={b.busy_days_total}
                    idle={b.idle_days_total}
                  />
                </button>
              )
            })}
          </div>
        </Card>

        {/* Per-crew drilldown */}
        <Card padding="none" className="lg:col-span-3 overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <CardTitle>
              {selectedBranch ? selectedBranch.branch_name : 'Select a branch'}
            </CardTitle>
            {selectedBranch && (
              <p className="text-xs text-fg-subtle mt-0.5">
                {PATTERN_TIPS[selectedBranch.pattern]}
              </p>
            )}
          </div>
          {selectedBranch && selectedCrews.length > 0 ? (
            <div className="divide-y divide-border">
              {selectedCrews.map((c) => (
                <CrewRow key={c.crew_index} crew={c} days={days} />
              ))}
            </div>
          ) : (
            <p className="px-4 py-6 text-sm text-fg-subtle">
              No crews to display.
            </p>
          )}
        </Card>
      </div>
    </div>
  )
}

function CrewRow({ crew, days }: { crew: CrewSummary; days: string[] }) {
  const idleSet = useMemo(() => {
    const s = new Set<string>()
    for (const streak of crew.streaks) {
      // Walk from start to end inclusive.
      const start = new Date(streak.start_date + 'T00:00:00Z')
      const end = new Date(streak.end_date + 'T00:00:00Z')
      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        s.add(d.toISOString().slice(0, 10))
      }
    }
    return s
  }, [crew.streaks])

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-fg truncate">
            {crew.crew_label}
          </span>
          <Badge variant={crew.pattern === 'blocks' ? 'warning' : 'outline'} className="text-[10px]">
            {crew.pattern}
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-xs text-fg-muted">
          <span>
            <span className="font-tabular text-fg">{crew.busy_days}</span> busy
          </span>
          <span>
            <span className="font-tabular text-fg">{crew.idle_days}</span> idle
          </span>
          {crew.longest_streak > 0 && (
            <span>
              longest <span className="font-tabular text-fg">{crew.longest_streak}</span>d
            </span>
          )}
          <span className="font-tabular text-fg">{crew.utilization_pct}%</span>
        </div>
      </div>
      {/* Date strip: one cell per workday. Idle = gray, busy = accent. */}
      <div
        className="flex gap-px overflow-x-auto rounded border border-border p-0.5 bg-surface-subtle/30"
        style={{ minHeight: 18 }}
      >
        {days.map((d) => {
          const idle = idleSet.has(d)
          return (
            <div
              key={d}
              className={cn(
                'h-3.5 flex-shrink-0 rounded-sm',
                idle ? 'bg-fg-subtle/30' : 'bg-accent/70'
              )}
              style={{ width: 4 }}
              title={`${d} · ${idle ? 'idle' : 'busy'}`}
            />
          )
        })}
      </div>
      {crew.streaks.length > 0 && (
        <p className="text-[11px] text-fg-subtle">
          Idle streaks:{' '}
          {crew.streaks
            .map((s) => `${s.start_date}${s.length > 1 ? `→${s.end_date} (${s.length}d)` : ''}`)
            .join(' · ')}
        </p>
      )}
    </div>
  )
}

function UtilizationBar({ busy, idle }: { busy: number; idle: number }) {
  const total = busy + idle
  if (total === 0) return null
  const busyPct = (busy / total) * 100
  return (
    <div className="mt-2 h-1.5 w-full rounded-full bg-fg-subtle/20 overflow-hidden">
      <div className="h-full bg-accent" style={{ width: `${busyPct}%` }} />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="font-mono font-semibold text-base text-fg">{value}</span>
      <span className="text-[10px] uppercase tracking-wide text-fg-subtle">
        {label}
      </span>
    </div>
  )
}

function branchKey(b: BranchSummary): string {
  return b.branch_index == null ? `__none__` : `b${b.branch_index}`
}
