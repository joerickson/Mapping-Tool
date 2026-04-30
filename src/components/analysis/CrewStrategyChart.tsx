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
import { TriangleAlert } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'
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
  work_hours: number
  available_hours: number
  utilization_pct: number
  property_count: number
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
}

interface CrewStrategyOutputs {
  property_count: number
  k_used: number
  total_project_hours_per_year: number
  crew_count_analysis?: CrewCountAnalysis
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

export default function CrewStrategyChart({ data }: { data: CrewStrategyOutputs }) {
  const theme = useChartTheme()
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
      {/* Recommendation banner — quiet accent-subtle, no gradient. */}
      <div className="rounded-md border border-accent/20 bg-accent-subtle px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
          Recommended
        </p>
        <p className="mt-0.5 text-base font-semibold text-fg">
          Option {data.recommended_option}: {data.options[data.recommended_option].label}
        </p>
        <p className="mt-1 text-sm text-fg-muted">{data.recommended_rationale}</p>
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
            (conservative)
            {data.crew_count_analysis.optimistic.crews_needed !==
              data.crew_count_analysis.conservative.crews_needed && (
              <>
                {' — '}
                <span className="font-tabular font-semibold">
                  {data.crew_count_analysis.optimistic.crews_needed}
                </span>{' '}
                with small-property pairing (optimistic)
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
        </Card>
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

      {/* 3-card option comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {opts.map((o) => (
          <Card
            key={o.key}
            padding="md"
            className={
              o.key === data.recommended_option ? 'ring-1 ring-accent' : undefined
            }
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                  Option {o.key}
                </p>
                <p className="mt-0.5 font-semibold text-fg">{o.label}</p>
              </div>
              {o.key === data.recommended_option && (
                <Badge variant="success">Recommended</Badge>
              )}
            </div>

            <dl className="my-3 grid grid-cols-2 gap-3 border-y border-border py-3 text-sm">
              <Stat label="Crews">
                <span className="font-tabular">{o.crew_count}</span>
                {o.crew_count_optimistic != null &&
                  o.crew_count_optimistic !== o.crew_count && (
                    <span className="text-fg-muted text-xs">
                      {' '}
                      (or <span className="font-tabular">{o.crew_count_optimistic}</span> w/ pairing)
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
          </Card>
        ))}
      </div>

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
              <TableHead className="text-right">Work hrs</TableHead>
              <TableHead className="text-right">Available</TableHead>
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
                <TableCell numeric>{b.work_hours.toLocaleString()}</TableCell>
                <TableCell numeric className="text-fg-muted">
                  {b.available_hours.toLocaleString()}
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
