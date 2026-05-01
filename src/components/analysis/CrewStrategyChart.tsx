import { useEffect, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
  CartesianGrid,
} from 'recharts'
import { Check, TriangleAlert, Settings2 } from 'lucide-react'
import { Badge } from '../ui/Badge'
import Button from '../ui/Button'
import { Card } from '../ui/Card'
import { useAuth } from '../../hooks/useAuth'
import BranchAllocationDialog from './BranchAllocationDialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/Table'
import { tickStyle, tooltipStyle, useChartTheme } from '../../hooks/useChartTheme'
import { cn } from '../../lib/cn'

type UtilStatus = 'ideal' | 'acceptable' | 'underutilized' | 'overcapacity'

interface BranchUtilRow {
  branch_name: string
  city_state?: string
  population?: number | null
  crew_count: number
  crew_count_optimistic?: number
  work_hours: number
  available_hours: number
  utilization_pct: number
  property_count: number
  building_days?: number
  available_work_days?: number
  avg_drive_miles_one_way?: number
  avg_drive_minutes_one_way?: number
  override_property_count?: number
  status: UtilStatus
  warning?: string | null
  surge_recommendation?: { surge_crews: number; surge_weeks: number } | null
}

interface CrewOption {
  label: string
  crew_count: number
  crew_count_optimistic?: number
  surge_crew_count?: number
  surge_weeks?: number
  utilization_pct: number
  annual_labor_cost: number
  annual_vehicle_cost: number
  total_annual_cost: number
  pros: string[]
  cons: string[]
  recommended_use_case: string
  branch_breakdown?: BranchUtilRow[]
  utilization_breakdown?: {
    per_branch?: BranchUtilRow[]
    per_region?: Array<{
      region: string
      branches_in_region: string[]
      work_hours: number
      available_hours: number
      aggregate_utilization_pct: number
      status: UtilStatus
    }>
    portfolio: {
      crew_count: number
      surge_crew_count?: number
      work_hours: number
      available_hours: number
      utilization_pct: number
      status: UtilStatus
    }
  }
}

interface CrewCountAnalysis {
  conservative: {
    crews_needed: number
    total_crew_days_per_cycle: number
    working_days_per_cycle: number
    rationale: string
  }
  optimistic: {
    crews_needed: number
    total_crew_days_per_cycle: number
    working_days_per_cycle: number
    rationale: string
  }
  size_class_breakdown: {
    small: number
    standard: number
    large: number
    multi_day: number
  }
  total_visits_per_cycle: number
  cycles_per_year: number
  audit?: {
    top_consumers: Array<{
      service_location_id: string
      hours_per_visit: number
      size_class: 'small' | 'standard' | 'large' | 'multi_day'
      crew_days_per_visit_conservative: number
    }>
    multi_day_visits: number
    multi_day_crew_days: number
    visits_per_year_distribution: Record<string, number>
  }
}

interface CrewStrategyBranch {
  name: string
  lat: number
  lng: number
  city_state?: string | null
}

interface CrewStrategyOutputs {
  property_count: number
  k_used: number
  total_project_hours_per_year: number
  crew_count_analysis?: CrewCountAnalysis
  branches?: CrewStrategyBranch[]
  options: { A: CrewOption; B: CrewOption; C: CrewOption }
  recommended_option: 'A' | 'B' | 'C'
  recommended_rationale: string
  utilization_constraint?: {
    enabled: boolean
    hard_floor_pct: number
    soft_ceiling_pct: number
    ideal_min_pct: number
    ideal_max_pct: number
    scope: 'per_branch' | 'per_region' | 'portfolio'
  }
  constraint_violations?: Array<{
    scope: 'branch' | 'region' | 'portfolio'
    name: string
    metric: string
    actual: number
    threshold_violated: 'hard_floor' | 'soft_ceiling' | 'ideal_min' | 'ideal_max'
    severity: 'warning' | 'flag'
    suggestion: string
  }>
}

const STATUS_VARIANT: Record<UtilStatus, 'success' | 'warning' | 'danger'> = {
  ideal: 'success',
  acceptable: 'warning',
  underutilized: 'danger',
  overcapacity: 'danger',
}
const STATUS_LABEL: Record<UtilStatus, string> = {
  ideal: 'Ideal',
  acceptable: 'Acceptable',
  underutilized: 'Underutilized',
  overcapacity: 'Overcapacity',
}

function formatPop(p: number | null | undefined): string {
  if (p == null) return '—'
  if (p >= 1_000_000) return `${(p / 1_000_000).toFixed(1)}M`
  if (p >= 1000) return `${(p / 1000).toFixed(0)}K`
  return p.toString()
}

interface CrewStrategyChartProps {
  data: CrewStrategyOutputs
  accountId?: string
  clientId?: string
  onAllocationsSaved?: () => void
}

export default function CrewStrategyChart({
  data,
  accountId,
  clientId,
  onAllocationsSaved,
}: CrewStrategyChartProps) {
  const theme = useChartTheme()
  const { getToken } = useAuth()
  const [allocOpen, setAllocOpen] = useState(false)
  // Phase 4.2 — user-selected option (overrides recommended_option in
  // Bid Pricing). null while loading; falls back to recommended_option
  // if the user hasn't picked one.
  const [selectedOption, setSelectedOption] = useState<'A' | 'B' | 'C' | null>(null)
  const [savingSelection, setSavingSelection] = useState<'A' | 'B' | 'C' | null>(null)
  // Phase 4.2 — manual per-branch crew override. Empty object = no
  // override; non-empty = bid pricing uses these counts.
  const [crewOverride, setCrewOverride] = useState<Record<string, number>>({})
  const [overrideEnabled, setOverrideEnabled] = useState(false)
  const [savingOverride, setSavingOverride] = useState(false)

  useEffect(() => {
    if (!accountId || !clientId) return
    let cancelled = false
    ;(async () => {
      try {
        const token = await getToken()
        const res = await fetch(
          `/api/accounts/${accountId}/clients/${clientId}/operational-constraints`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (!res.ok) return
        const j = await res.json()
        if (!cancelled) {
          const v = j?.crew_strategy_selected_option
          setSelectedOption(v === 'A' || v === 'B' || v === 'C' ? v : null)
          const ov = j?.crew_count_per_branch_override
          if (ov && typeof ov === 'object') {
            const cleaned: Record<string, number> = {}
            for (const [k, val] of Object.entries(ov)) {
              const n = Number(val)
              if (Number.isFinite(n) && n > 0) cleaned[k] = Math.floor(n)
            }
            setCrewOverride(cleaned)
            setOverrideEnabled(Object.keys(cleaned).length > 0)
          }
        }
      } catch {
        // non-fatal — fall back to recommended_option
      }
    })()
    return () => {
      cancelled = true
    }
  }, [accountId, clientId, getToken])

  const saveSelection = async (opt: 'A' | 'B' | 'C') => {
    if (!accountId || !clientId) return
    setSavingSelection(opt)
    // Optimistic update — keep this even after save completes so the
    // ring stays on the chosen card. We deliberately do NOT call
    // onAllocationsSaved here because that re-runs Crew Strategy,
    // which remounts this chart and resets selectedOption to null
    // while the GET races to refetch the saved value (the "flash"
    // back to recommended). The selection only affects Bid Pricing,
    // and Bid Pricing reads the value when it next runs.
    setSelectedOption(opt)
    try {
      const token = await getToken()
      await fetch(
        `/api/accounts/${accountId}/clients/${clientId}/operational-constraints`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ crew_strategy_selected_option: opt }),
        }
      )
    } finally {
      setSavingSelection(null)
    }
  }

  const saveOverride = async (
    nextOverride: Record<string, number>,
    enabled: boolean
  ) => {
    if (!accountId || !clientId) return
    setSavingOverride(true)
    try {
      const token = await getToken()
      const body = enabled && Object.keys(nextOverride).length > 0
        ? { crew_count_per_branch_override: nextOverride }
        : { crew_count_per_branch_override: null }
      await fetch(
        `/api/accounts/${accountId}/clients/${clientId}/operational-constraints`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        }
      )
    } finally {
      setSavingOverride(false)
    }
  }

  const activeOption: 'A' | 'B' | 'C' = selectedOption ?? data.recommended_option
  // Per-branch breakdown comes from Option B but applies to any allocation
  // discussion; surface it as a dedicated panel above the option cards.
  const branchBreakdown = data.options.B.utilization_breakdown?.per_branch
    ?? data.options.B.branch_breakdown
    ?? []

  // Build the per-branch override map "as the user sees it" — for each
  // branch, take the user's typed value if present, otherwise fall
  // back to that branch's recommended count from Option B's breakdown.
  // The total is then a sum of EVERY branch's visible value, not just
  // the ones the user explicitly typed into. This matches the inputs
  // they see on screen.
  const visibleOverride: Record<string, number> = {}
  for (const b of data.branches ?? []) {
    if (crewOverride[b.name] != null) {
      visibleOverride[b.name] = crewOverride[b.name]
    } else {
      const rec = branchBreakdown.find((bb) => bb.branch_name === b.name)?.crew_count ?? 0
      visibleOverride[b.name] = rec
    }
  }
  const overrideTotal = Object.values(visibleOverride).reduce(
    (s, v) => s + (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0),
    0
  )
  const allowAllocations =
    accountId != null && clientId != null && (data.branches?.length ?? 0) > 0
  const opts = [
    { key: 'A' as const, ...data.options.A },
    { key: 'B' as const, ...data.options.B },
    { key: 'C' as const, ...data.options.C },
  ]

  const chartData = opts.map((o) => ({
    name: o.label,
    labor: o.annual_labor_cost,
    vehicle: o.annual_vehicle_cost,
    total: o.total_annual_cost,
    isRecommended: o.key === data.recommended_option,
  }))

  return (
    <div className="space-y-6">
      {/* Recommendation + active selection banner. */}
      <div className="rounded-md border border-accent/20 bg-accent-subtle px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
          {selectedOption && selectedOption !== data.recommended_option
            ? 'Active (your selection)'
            : 'Recommended'}
        </p>
        <p className="mt-0.5 text-base font-semibold text-fg">
          Option {activeOption}: {data.options[activeOption].label}
        </p>
        <p className="mt-1 text-sm text-fg-muted">
          {selectedOption && selectedOption !== data.recommended_option
            ? `You picked Option ${selectedOption}. The analysis recommended Option ${data.recommended_option}: ${data.options[data.recommended_option].label}.`
            : data.recommended_rationale}
        </p>
      </div>

      {/* Phase 3.8 — Building-count math summary */}
      {data.crew_count_analysis && (
        <Card padding="md">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
            Building-count crew math
          </p>
          <p className="mt-1 text-sm text-fg">
            <span className="font-tabular font-semibold">
              {data.crew_count_analysis.conservative.crews_needed} crews
            </span>{' '}
            assuming 1 building/day
            {data.crew_count_analysis.optimistic.crews_needed !==
              data.crew_count_analysis.conservative.crews_needed && (
              <>
                {' — drops to '}
                <span className="font-tabular font-semibold">
                  {data.crew_count_analysis.optimistic.crews_needed}
                </span>{' '}
                if dispatchers pair up small (≤4 hr) buildings 2-per-day
              </>
            )}
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            {data.crew_count_analysis.conservative.total_crew_days_per_cycle} building-days ÷{' '}
            {data.crew_count_analysis.conservative.working_days_per_cycle} working days ={' '}
            {(
              data.crew_count_analysis.conservative.total_crew_days_per_cycle /
              data.crew_count_analysis.conservative.working_days_per_cycle
            ).toFixed(2)}{' '}
            → {data.crew_count_analysis.conservative.crews_needed} crews.
          </p>
          <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <Stat label="Small (≤4 hr)">
              <span className="font-tabular">
                {data.crew_count_analysis.size_class_breakdown.small}
              </span>
            </Stat>
            <Stat label="Standard (4–8 hr)">
              <span className="font-tabular">
                {data.crew_count_analysis.size_class_breakdown.standard}
              </span>
            </Stat>
            <Stat label="Large (8–16 hr)">
              <span className="font-tabular">
                {data.crew_count_analysis.size_class_breakdown.large}
              </span>
            </Stat>
            <Stat label="Multi-day (>16 hr)">
              <span className="font-tabular">
                {data.crew_count_analysis.size_class_breakdown.multi_day}
              </span>
            </Stat>
          </dl>
          {data.crew_count_analysis.audit && (
            <details className="mt-4 group">
              <summary className="cursor-pointer text-xs font-semibold text-accent hover:underline list-none">
                Why this many crews? Audit the math ▾
              </summary>
              <div className="mt-3 space-y-3 text-xs">
                {data.crew_count_analysis.audit.multi_day_visits > 0 && (
                  <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
                    <p className="font-semibold text-fg">
                      Multi-day buildings consume {data.crew_count_analysis.audit.multi_day_crew_days} crew-days
                    </p>
                    <p className="mt-1 text-fg-muted leading-relaxed">
                      <span className="font-tabular">{data.crew_count_analysis.audit.multi_day_visits}</span> visit
                      {data.crew_count_analysis.audit.multi_day_visits === 1 ? '' : 's'} are at buildings
                      &gt;16 hours each, which take{' '}
                      <span className="font-mono">ceil(hours ÷ 8)</span> crew-days per visit instead of 1.
                      {' '}A 32-hour building = 4 crew-days, not 1.
                    </p>
                  </div>
                )}
                {Object.keys(data.crew_count_analysis.audit.visits_per_year_distribution).length > 1 && (
                  <div className="rounded-md border border-border bg-surface p-3">
                    <p className="font-semibold text-fg">Visits per year distribution</p>
                    <ul className="mt-1 text-fg-muted">
                      {Object.entries(
                        data.crew_count_analysis.audit.visits_per_year_distribution
                      )
                        .sort(([a], [b]) => Number(a) - Number(b))
                        .map(([visits, count]) => (
                          <li key={visits}>
                            <span className="font-tabular">{count}</span> propert
                            {count === 1 ? 'y' : 'ies'} visited{' '}
                            <span className="font-tabular">{visits}</span>×/year ={' '}
                            <span className="font-tabular">{Number(visits) * count}</span> crew-days
                          </li>
                        ))}
                    </ul>
                    <p className="mt-2 text-fg-subtle italic">
                      A property visited 4×/year contributes 4 crew-days, not 1.
                      Default is 2; check Cost Assumptions or per-SL overrides if any are higher.
                    </p>
                  </div>
                )}
                {data.crew_count_analysis.audit.top_consumers.length > 0 && (
                  <div className="rounded-md border border-border bg-surface p-3">
                    <p className="font-semibold text-fg">Top crew-day consumers</p>
                    <table className="mt-2 w-full text-[11px]">
                      <thead className="text-fg-subtle text-[10px] uppercase tracking-wider">
                        <tr>
                          <th className="text-left pb-1">Property (id)</th>
                          <th className="text-right pb-1">Hours/visit</th>
                          <th className="text-right pb-1">Size class</th>
                          <th className="text-right pb-1">Crew-days/visit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.crew_count_analysis.audit.top_consumers.map((c) => (
                          <tr key={c.service_location_id}>
                            <td className="py-1 font-mono text-fg-muted">
                              {c.service_location_id.slice(0, 8)}…
                            </td>
                            <td className="py-1 text-right font-tabular">
                              {c.hours_per_visit}
                            </td>
                            <td className="py-1 text-right font-tabular">
                              {c.size_class}
                            </td>
                            <td className="py-1 text-right font-mono font-semibold">
                              {c.crew_days_per_visit_conservative}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-fg-subtle italic leading-relaxed">
                  Formula: total crew-days ÷ working days/cycle = crews needed.
                  Each visit contributes 1 crew-day (1 building/day rule), except
                  multi-day buildings which consume <span className="font-mono">ceil(hours ÷ 8)</span> days.
                  Optimistic mode pairs two small (≤4hr) buildings per day, halving their contribution.
                </p>
              </div>
            </details>
          )}
        </Card>
      )}

      {/* Phase 3.9a — Branch property allocations */}
      {branchBreakdown.length > 0 && (
        <Card padding="md">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                Branch property allocations
              </p>
              <p className="mt-1 text-sm text-fg-muted">
                Each branch's properties drive its dedicated crew count. Reassign properties to rebalance utilization.
              </p>
            </div>
            {allowAllocations && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setAllocOpen(true)}
              >
                <Settings2 className="h-3.5 w-3.5 mr-1.5" />
                Manage assignments
              </Button>
            )}
          </div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {branchBreakdown.map((b) => (
              <div
                key={b.branch_name}
                className="rounded-md border border-border bg-surface-subtle/40 p-3 text-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-fg truncate">
                      {b.city_state || b.branch_name}
                    </p>
                    {b.population != null && (
                      <p className="text-[10px] text-fg-subtle">
                        Pop. {formatPop(b.population)}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] uppercase tracking-wider text-fg-subtle">Crews</p>
                    <p className="font-tabular font-semibold text-fg">
                      {b.crew_count}
                      {b.crew_count_optimistic != null &&
                        b.crew_count_optimistic !== b.crew_count && (
                          <span className="text-fg-muted text-xs"> / {b.crew_count_optimistic}</span>
                        )}
                    </p>
                  </div>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-1.5 text-xs">
                  <Stat label="Properties">
                    <span className="font-tabular">{b.property_count}</span>
                    {b.override_property_count != null && b.override_property_count > 0 && (
                      <span className="text-warning text-[10px]"> ({b.override_property_count} override)</span>
                    )}
                  </Stat>
                  <Stat label="Hours/yr">
                    <span className="font-tabular">{b.work_hours.toLocaleString()}</span>
                  </Stat>
                  <Stat label="Utilization">
                    <Badge variant={STATUS_VARIANT[b.status]} className="text-[10px]">
                      {b.utilization_pct}%
                    </Badge>
                  </Stat>
                  <Stat label="Avg drive">
                    <span className="font-tabular">
                      {b.avg_drive_miles_one_way != null
                        ? `${b.avg_drive_miles_one_way}mi`
                        : '—'}
                      {b.avg_drive_minutes_one_way != null && b.avg_drive_minutes_one_way > 0 && (
                        <span className="text-fg-subtle text-[10px]"> · {b.avg_drive_minutes_one_way}m</span>
                      )}
                    </span>
                  </Stat>
                </dl>
                {b.warning && (
                  <p className="mt-2 text-[10px] text-warning leading-snug">
                    <TriangleAlert className="h-3 w-3 inline mr-0.5" />
                    {b.warning}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {allowAllocations && (
        <BranchAllocationDialog
          open={allocOpen}
          onClose={() => setAllocOpen(false)}
          accountId={accountId!}
          clientId={clientId!}
          branches={
            (data.branches ?? []).map((b) => ({
              name: b.name,
              lat: b.lat,
              lng: b.lng,
              city_state: b.city_state ?? null,
            }))
          }
          onSaved={onAllocationsSaved}
        />
      )}

      {/* Cost comparison bar chart */}
      <section className="space-y-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
          Annual cost comparison
        </h4>
        <div className="h-56 w-full">
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="name"
                tick={tickStyle(theme)}
                axisLine={{ stroke: theme.grid }}
                tickLine={false}
              />
              <YAxis
                tick={tickStyle(theme)}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                cursor={{ fill: theme.grid, opacity: 0.4 }}
                contentStyle={tooltipStyle(theme)}
                formatter={(v: number, name: string) => [`$${v.toLocaleString()}`, name]}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: theme.tick }} />
              <Bar dataKey="labor" stackId="a" fill={theme.accent} name="Labor" />
              <Bar dataKey="vehicle" stackId="a" fill="#a855f7" name="Vehicle / fuel">
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.isRecommended ? theme.success : '#a855f7'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* 3-card option comparison — click to choose which option flows
          into Bid Pricing. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {opts.map((o) => {
          const isActive = o.key === activeOption
          const isRecommended = o.key === data.recommended_option
          const isSaving = savingSelection === o.key
          return (
          <button
            key={o.key}
            type="button"
            onClick={() => saveSelection(o.key)}
            disabled={isSaving}
            aria-pressed={isActive}
            className={cn(
              'text-left rounded-lg border bg-surface p-4 transition-all',
              'hover:border-accent/60 hover:shadow-sm',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1',
              isActive
                ? 'border-accent ring-2 ring-accent shadow-sm'
                : 'border-border'
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                  Option {o.key}
                </p>
                <p className="mt-0.5 font-semibold text-fg">{o.label}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                {isActive && (
                  <Badge variant="accent" className="inline-flex items-center gap-1">
                    <Check className="h-3 w-3" />
                    {selectedOption === o.key ? 'Selected' : 'Active'}
                  </Badge>
                )}
                {isRecommended && !isActive && (
                  <Badge variant="success">Recommended</Badge>
                )}
              </div>
            </div>

            <dl className="my-3 grid grid-cols-2 gap-3 border-y border-border py-3 text-sm">
              <Stat label="Crews">
                <span className="font-tabular">{o.crew_count}</span>
                {o.crew_count_optimistic != null &&
                  o.crew_count_optimistic !== o.crew_count && (
                    <span
                      className="text-fg-muted text-xs"
                      title={`Optimistic count assumes small buildings (≤4 work-hours each) get paired so a crew handles two of them in one day. ${o.crew_count_optimistic} is the floor if your dispatchers consistently pair them; ${o.crew_count} is the ceiling without pairing.`}
                    >
                      {' '}
                      (down to <span className="font-tabular">{o.crew_count_optimistic}</span> if small buildings are paired)
                    </span>
                  )}
                {o.surge_crew_count ? (
                  <span className="text-fg-muted">
                    {' + '}
                    <span className="font-tabular">{o.surge_crew_count}</span> surge
                  </span>
                ) : null}
              </Stat>
              <Stat label="Utilization">
                <span className="font-tabular">{o.utilization_pct}%</span>
              </Stat>
              <Stat label="Labor">
                <span className="font-tabular">
                  ${(o.annual_labor_cost / 1000).toFixed(0)}k
                </span>
              </Stat>
              <Stat label="Total">
                <span className="font-tabular">
                  ${(o.total_annual_cost / 1000).toFixed(0)}k
                </span>
              </Stat>
            </dl>

            <ProsCons label="Pros" items={o.pros} />
            <ProsCons label="Cons" items={o.cons} className="mt-2" />

            <p className="mt-3 border-t border-border pt-2 text-xs italic text-fg-subtle">
              Best for: {o.recommended_use_case}
            </p>
            <p className="mt-2 text-[10px] text-fg-subtle">
              {isActive
                ? 'Used by Bid Pricing.'
                : 'Click to use this option in Bid Pricing.'}
            </p>
          </button>
          )
        })}
      </div>

      {/* Phase 4.2 — Manual per-branch crew override. Inputs are
          always visible so the user can directly type. Override is
          ACTIVE whenever the sum of inputs > 0; clearing all inputs
          (or pressing "Use Option {activeOption}") falls back to the
          A/B/C selection. */}
      {(data.branches?.length ?? 0) > 0 && (
        <Card
          padding="md"
          className={overrideEnabled && overrideTotal > 0 ? 'border-accent ring-1 ring-accent' : undefined}
        >
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                Manual crew override
              </p>
              <p className="mt-1 text-sm text-fg">
                Type the number of crews you want at each branch. Any
                non-zero entry switches Bid Pricing, Workforce Sizing,
                and Seasonality off Option {activeOption} and onto your
                numbers.
              </p>
            </div>
            {overrideEnabled && overrideTotal > 0 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setCrewOverride({})
                  setOverrideEnabled(false)
                  void saveOverride({}, false)
                }}
              >
                Use Option {activeOption} instead
              </Button>
            )}
          </div>

          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {(data.branches ?? []).map((b) => {
                // Default the input to whatever the active option
                // assigns to this branch — that way the field shows
                // a real starting number and any edit is a clear
                // override.
                const breakdown = branchBreakdown.find(
                  (bb) => bb.branch_name === b.name
                )
                const recommended = breakdown?.crew_count ?? 0
                const userValue = crewOverride[b.name]
                const value = userValue ?? recommended
                const isDirty = userValue != null && userValue !== recommended
                return (
                  <div
                    key={b.name}
                    className={cn(
                      'rounded-md border bg-surface-subtle/40 p-3',
                      isDirty ? 'border-accent' : 'border-border'
                    )}
                  >
                    <p className="text-sm font-semibold text-fg truncate">
                      {b.city_state || b.name}
                    </p>
                    {breakdown && (
                      <p className="text-[10px] text-fg-subtle mt-0.5">
                        {breakdown.property_count} properties ·{' '}
                        {breakdown.work_hours.toLocaleString()} hr/yr · Option{' '}
                        {activeOption} rec:{' '}
                        <span className="font-tabular">{recommended}</span>{' '}
                        crews
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      <label className="text-xs text-fg-muted">Crews:</label>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={value}
                        onChange={(e) => {
                          const raw = e.target.value
                          const n = raw === '' ? 0 : Math.max(0, Math.floor(Number(raw)))
                          setCrewOverride((prev) => ({ ...prev, [b.name]: n }))
                          // Override is implicitly enabled the moment
                          // the user types anything. Keep state in sync.
                          if (!overrideEnabled) setOverrideEnabled(true)
                        }}
                        onBlur={() => {
                          // Save the FULL per-branch map the user sees
                          // on screen (override values + recommended
                          // fallbacks for branches they left untouched),
                          // so the bid pricing / workforce / seasonality
                          // modules see crew counts for every branch,
                          // not just the ones the user typed into.
                          const fullMap: Record<string, number> = {}
                          for (const branch of data.branches ?? []) {
                            const u = crewOverride[branch.name]
                            if (u != null) {
                              fullMap[branch.name] = u
                            } else {
                              const rec = branchBreakdown.find(
                                (bb) => bb.branch_name === branch.name
                              )?.crew_count ?? 0
                              fullMap[branch.name] = rec
                            }
                          }
                          const total = Object.values(fullMap).reduce(
                            (s, v) =>
                              s + (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0),
                            0
                          )
                          void saveOverride(fullMap, total > 0)
                        }}
                        className="w-20 h-8 rounded-md border border-border bg-surface px-2 text-sm font-mono text-fg focus-visible:outline-none focus-visible:border-border-focus focus-visible:ring-2 focus-visible:ring-accent"
                      />
                      {isDirty && (
                        <span className="text-[10px] text-accent">overridden</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-border flex-wrap gap-2">
              <p className="text-sm text-fg">
                Total crews:{' '}
                <span className="font-mono font-semibold tabular-nums">
                  {overrideEnabled && overrideTotal > 0
                    ? overrideTotal
                    : data.options[activeOption].crew_count}
                </span>
                {overrideEnabled && overrideTotal > 0 && (
                  <span className="text-xs text-fg-muted ml-2">
                    override (vs Option {activeOption}:{' '}
                    <span className="font-tabular">
                      {data.options[activeOption].crew_count}
                    </span>
                    )
                  </span>
                )}
              </p>
              <p className="text-xs text-fg-subtle">
                {savingOverride
                  ? 'Saving…'
                  : overrideEnabled && overrideTotal > 0
                    ? 'Override active. Re-run Bid Pricing / Workforce / Seasonality to apply.'
                    : 'No override active. Type any crew count to start.'}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Utilization breakdown for Option B (driven by user-selected scope) */}
      {data.options.B.utilization_breakdown && (
        <UtilizationSection
          option={data.options.B}
          scope={data.utilization_constraint?.scope ?? 'per_branch'}
        />
      )}

      {/* Constraint violations */}
      {data.constraint_violations && data.constraint_violations.length > 0 && (
        <section className="space-y-2">
          <h4 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
            <TriangleAlert className="h-3.5 w-3.5 text-warning" aria-hidden />
            Constraint violations
          </h4>
          <ul className="space-y-2">
            {data.constraint_violations.map((v, i) => (
              <li
                key={i}
                className={cn(
                  'rounded-md border-l-2 px-3 py-2 text-sm',
                  v.severity === 'flag'
                    ? 'border-danger bg-danger-subtle'
                    : 'border-warning bg-warning-subtle'
                )}
              >
                <p className="font-medium text-fg">
                  {v.scope === 'branch' ? '' : `${v.scope.toUpperCase()} `}
                  {v.name}
                </p>
                <p className="text-xs text-fg-muted">
                  {v.metric === 'utilization_pct' ? (
                    <>
                      <span className="font-tabular">{v.actual}%</span> utilization
                    </>
                  ) : (
                    <span className="font-tabular">{v.actual}</span>
                  )}
                  {' — '}
                  {v.threshold_violated.replace('_', ' ')}
                </p>
                <p className="mt-0.5 text-xs italic text-fg-subtle">{v.suggestion}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Stat({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
        {label}
      </dt>
      <dd className="mt-0.5 font-semibold text-fg">{children}</dd>
    </div>
  )
}

function ProsCons({
  label,
  items,
  className,
}: {
  label: string
  items: string[]
  className?: string
}) {
  return (
    <div className={className}>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
        {label}
      </p>
      <ul className="list-disc space-y-0.5 pl-4 text-xs text-fg">
        {items.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
    </div>
  )
}

function UtilizationSection({
  option,
  scope,
}: {
  option: CrewOption
  scope: 'per_branch' | 'per_region' | 'portfolio'
}) {
  const ub = option.utilization_breakdown
  if (!ub) return null

  if (scope === 'portfolio' && ub.portfolio) {
    return (
      <section className="space-y-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
          Portfolio utilization (Option B)
        </h4>
        <Card padding="md" className="flex items-center justify-between gap-4">
          <div>
            <p className="font-mono text-2xl font-semibold tabular-nums text-fg leading-none">
              {ub.portfolio.utilization_pct}%
            </p>
            <p className="mt-1 text-xs text-fg-muted">
              <span className="font-tabular">
                {ub.portfolio.work_hours.toLocaleString()}
              </span>{' '}
              work hrs ÷{' '}
              <span className="font-tabular">
                {ub.portfolio.available_hours.toLocaleString()}
              </span>{' '}
              available ·{' '}
              <span className="font-tabular">{ub.portfolio.crew_count}</span> crews
            </p>
          </div>
          <Badge variant={STATUS_VARIANT[ub.portfolio.status]}>
            {STATUS_LABEL[ub.portfolio.status]}
          </Badge>
        </Card>
      </section>
    )
  }

  if (scope === 'per_region' && ub.per_region && ub.per_region.length > 0) {
    return (
      <section className="space-y-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
          Per-region utilization (Option B)
        </h4>
        <div className="rounded-md border border-border bg-surface overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Region</TableHead>
                <TableHead>Branches</TableHead>
                <TableHead className="text-right">Work hrs</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Util</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ub.per_region.map((r) => (
                <TableRow key={r.region}>
                  <TableCell className="font-medium text-fg">{r.region}</TableCell>
                  <TableCell className="text-xs text-fg-muted">
                    {r.branches_in_region.join(', ')}
                  </TableCell>
                  <TableCell numeric>{r.work_hours.toLocaleString()}</TableCell>
                  <TableCell numeric>{r.available_hours.toLocaleString()}</TableCell>
                  <TableCell numeric>{r.aggregate_utilization_pct}%</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    )
  }

  // per_branch (default)
  if (!ub.per_branch || ub.per_branch.length === 0) return null
  return (
    <section className="space-y-2">
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
        Per-branch utilization (Option B)
      </h4>
      <div className="rounded-md border border-border bg-surface overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Branch</TableHead>
              <TableHead className="text-right">Pop</TableHead>
              <TableHead className="text-right">Crews</TableHead>
              <TableHead className="text-right">Buildings</TableHead>
              <TableHead className="text-right">Building-days</TableHead>
              <TableHead className="text-right">Available work days</TableHead>
              <TableHead className="text-right">Util</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ub.per_branch.map((b) => (
              <TableRow key={b.branch_name} className="align-top">
                <TableCell className="font-medium text-fg">
                  {b.city_state ?? b.branch_name}
                  {b.branch_name &&
                    b.city_state &&
                    b.branch_name !== b.city_state && (
                      <p className="mt-0.5 text-xs italic text-fg-subtle">
                        {b.branch_name}
                      </p>
                    )}
                </TableCell>
                <TableCell numeric className="text-fg-muted">
                  {formatPop(b.population)}
                </TableCell>
                <TableCell numeric>{b.crew_count}</TableCell>
                <TableCell numeric>{b.property_count.toLocaleString()}</TableCell>
                <TableCell numeric className="text-fg-muted">
                  {b.building_days != null
                    ? b.building_days.toLocaleString()
                    : '—'}
                </TableCell>
                <TableCell numeric className="text-fg-muted">
                  {b.available_work_days != null
                    ? b.available_work_days.toLocaleString()
                    : '—'}
                </TableCell>
                <TableCell numeric className="font-semibold">
                  {b.utilization_pct}%
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[b.status]}>{STATUS_LABEL[b.status]}</Badge>
                  {b.warning && (
                    <p className="mt-1 max-w-xs text-xs italic text-fg-subtle">
                      {b.warning}
                    </p>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}
