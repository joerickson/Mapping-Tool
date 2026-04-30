import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
  CartesianGrid,
} from 'recharts'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'
import { tickStyle, tooltipStyle, useChartTheme } from '../../hooks/useChartTheme'
import { cn } from '../../lib/cn'

interface WindowResult {
  window_name: string
  start_date: string
  end_date: string
  duration_days: number
  demand: {
    service_location_count: number
    total_hours_required: number
    crew_days_required: number
    simultaneous_crews_needed: number
  }
  baseline_capacity: {
    crew_count: number
    crew_days_available: number
  }
  surge_required: boolean
  surge_crews_needed: number
  notes: string
}

interface SeasonalityOutputs {
  property_count: number
  windows: WindowResult[]
  year_round_baseline: {
    service_location_count: number
    property_count: number
    avg_weekly_hours: number
    crews_required: number
  }
  peak_to_baseline_ratio: number
  baseline_crew_count_used: number
}

const WINDOW_LABEL: Record<string, string> = {
  summer_break: 'Summer Break',
  winter_break: 'Winter Break',
  spring_break: 'Spring Break',
}

export default function SeasonalityChart({ data }: { data: SeasonalityOutputs }) {
  const theme = useChartTheme()
  const chartData = data.windows.map((w) => ({
    name: WINDOW_LABEL[w.window_name] ?? w.window_name,
    crews_needed: w.demand.simultaneous_crews_needed,
    surge_crews: w.surge_crews_needed,
    baseline: w.baseline_capacity.crew_count,
  }))

  const baseline = data.baseline_crew_count_used

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <MetricCard label="Baseline">
          <span className="font-mono text-2xl font-semibold tabular-nums text-fg">
            {baseline}
          </span>
          <span className="ml-1 text-sm text-fg-muted">crews</span>
          <p className="mt-1 text-xs text-fg-muted">
            <span className="font-tabular">
              {data.year_round_baseline.crews_required.toFixed(1)}
            </span>{' '}
            crews avg-week demand
          </p>
        </MetricCard>
        <MetricCard label="Peak ratio">
          <span className="font-mono text-2xl font-semibold tabular-nums text-fg">
            {data.peak_to_baseline_ratio}x
          </span>
          <p className="mt-1 text-xs text-fg-muted">
            peak-week vs avg-week demand
          </p>
        </MetricCard>
        <MetricCard label="Year-round">
          <span className="font-mono text-2xl font-semibold tabular-nums text-fg">
            {data.year_round_baseline.service_location_count}
          </span>
          <span className="ml-1 text-sm text-fg-muted">SLs</span>
          <p className="mt-1 text-xs text-fg-muted">
            <span className="font-tabular">
              {data.year_round_baseline.avg_weekly_hours.toLocaleString()}
            </span>{' '}
            hrs/week
          </p>
        </MetricCard>
      </div>

      <section className="space-y-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
          Simultaneous crews required by window (vs baseline of {baseline})
        </h4>
        <div className="h-48 w-full">
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="name"
                tick={tickStyle(theme)}
                axisLine={{ stroke: theme.grid }}
                tickLine={false}
              />
              <YAxis tick={tickStyle(theme)} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: theme.grid, opacity: 0.4 }}
                contentStyle={tooltipStyle(theme)}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: theme.tick }} />
              <ReferenceLine
                y={baseline}
                stroke={theme.success}
                strokeDasharray="3 3"
                label={{ value: 'Baseline', fontSize: 11, fill: theme.success }}
              />
              <Bar dataKey="crews_needed" fill={theme.accent} name="Crews needed" radius={[2, 2, 0, 0]} />
              <Bar dataKey="surge_crews" fill={theme.warning} name="Surge crews" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <ul className="space-y-2">
        {data.windows.map((w) => (
          <li
            key={w.window_name}
            className={cn(
              'rounded-md border-l-2 px-4 py-2',
              w.surge_required
                ? 'border-warning bg-warning-subtle'
                : 'border-border-strong bg-surface-subtle'
            )}
          >
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <p className="font-semibold text-fg">
                {WINDOW_LABEL[w.window_name] ?? w.window_name}
                <span className="ml-2 text-xs font-normal text-fg-muted">
                  <span className="font-tabular">{w.start_date}</span> –{' '}
                  <span className="font-tabular">{w.end_date}</span> ·{' '}
                  <span className="font-tabular">{w.duration_days}</span> days
                </span>
              </p>
              {w.surge_required && (
                <Badge variant="warning">
                  Surge required: +<span className="font-tabular">{w.surge_crews_needed}</span> crews
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-sm text-fg">
              <span className="font-tabular">{w.demand.service_location_count}</span> SLs ·{' '}
              <span className="font-tabular">
                {w.demand.total_hours_required.toLocaleString()}
              </span>{' '}
              hrs ·{' '}
              <span className="font-tabular">{w.demand.simultaneous_crews_needed}</span>{' '}
              simultaneous crews
            </p>
            <p className="mt-1 text-xs text-fg-muted">{w.notes}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function MetricCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card padding="sm">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
        {label}
      </p>
      <div className="mt-1">{children}</div>
    </Card>
  )
}
