import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
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

interface WorkforceOutputs {
  property_count: number
  workforce_a: {
    label: string
    description: string
    fte_equivalent?: number
    note: string
  }
  workforce_b: {
    label: string
    total_annual_hours: number
    fte_count: number
    part_time_position_count_estimate: number
    properties_served: number
    service_location_count: number
    by_offering: Array<{
      offering_name: string
      location_count: number
      total_hours: number
      fte_equivalent: number
    }>
  }
  total_workforce_size: {
    fte_equivalent: number
    distinct_positions_estimate: number
  }
}

export default function WorkforceSizingChart({ data }: { data: WorkforceOutputs }) {
  const theme = useChartTheme()
  const a = data.workforce_a
  const b = data.workforce_b
  const t = data.total_workforce_size

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <WorkforceCard label="Workforce A" subtitle={a.label}>
          <FteValue value={a.fte_equivalent} />
          <p className="mt-2 text-xs text-fg-muted">{a.note}</p>
        </WorkforceCard>

        <WorkforceCard label="Workforce B" subtitle={b.label}>
          <FteValue value={b.fte_count} />
          <p className="mt-1 text-xs text-fg-muted">
            <span className="font-tabular">
              {b.total_annual_hours.toLocaleString()}
            </span>{' '}
            hrs/year ·{' '}
            <span className="font-tabular">{b.properties_served}</span> properties
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            ~<span className="font-tabular">{b.part_time_position_count_estimate}</span>{' '}
            part-time positions
          </p>
        </WorkforceCard>

        <WorkforceCard label="Total" subtitle="Combined workforce">
          <FteValue value={t.fte_equivalent} />
          <p className="mt-1 text-xs text-fg-muted">
            ~<span className="font-tabular">{t.distinct_positions_estimate}</span>{' '}
            distinct positions (incl. part-time)
          </p>
        </WorkforceCard>
      </div>

      {b.by_offering.length > 0 && (
        <section className="space-y-3">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
            Workforce B by service offering
          </h4>
          <div className="h-44 w-full">
            <ResponsiveContainer>
              <BarChart
                data={b.by_offering}
                layout="vertical"
                margin={{ top: 4, right: 8, left: 80, bottom: 0 }}
              >
                <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  tick={tickStyle(theme)}
                  axisLine={{ stroke: theme.grid }}
                  tickLine={false}
                  tickFormatter={(v: number) => v.toLocaleString()}
                />
                <YAxis
                  type="category"
                  dataKey="offering_name"
                  tick={tickStyle(theme)}
                  axisLine={false}
                  tickLine={false}
                  width={120}
                />
                <Tooltip
                  cursor={{ fill: theme.grid, opacity: 0.4 }}
                  contentStyle={tooltipStyle(theme)}
                  formatter={(v: number) => [`${v.toLocaleString()} hrs`, 'Annual hours']}
                />
                <Bar dataKey="total_hours" fill={theme.accent} radius={[0, 2, 2, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-md border border-border bg-surface overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Offering</TableHead>
                  <TableHead className="text-right">Locations</TableHead>
                  <TableHead className="text-right">Annual hrs</TableHead>
                  <TableHead className="text-right">FTE</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {b.by_offering.map((o, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium text-fg">{o.offering_name}</TableCell>
                    <TableCell numeric>{o.location_count}</TableCell>
                    <TableCell numeric>{o.total_hours.toLocaleString()}</TableCell>
                    <TableCell numeric>{o.fte_equivalent.toFixed(1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}
    </div>
  )
}

function WorkforceCard({
  label,
  subtitle,
  children,
}: {
  label: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <Card padding="sm">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold text-fg">{subtitle}</p>
      {children}
    </Card>
  )
}

function FteValue({ value }: { value: number | undefined }) {
  return (
    <p className="mt-2 leading-none">
      <span className="font-mono text-2xl font-semibold tabular-nums text-fg">
        {value != null ? value.toFixed(1) : '—'}
      </span>
      <span className="ml-1 text-sm text-fg-muted">FTE</span>
    </p>
  )
}
