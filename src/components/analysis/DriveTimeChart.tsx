import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  CartesianGrid,
} from 'recharts'
import { Badge } from '../ui/Badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/Table'
import { tickStyle, tooltipStyle, useChartTheme } from '../../hooks/useChartTheme'

interface DriveTimeOutputs {
  drive_distribution: Record<string, number>
  cluster_efficiency: Array<{
    branch: string
    city_state?: string
    property_count: number
    avg_drive_minutes: number
    properties_within_60min_pct: number
    efficiency_score: 'high' | 'medium' | 'low'
  }>
  long_drive_properties: Array<{ property_id: string; address: string; drive_minutes: number }>
}

const BUCKET_LABELS: Record<string, string> = {
  under_30_min: '<30 min',
  '30_to_60_min': '30–60',
  '60_to_90_min': '60–90',
  '90_to_120_min': '90–120',
  over_120_min: '>120',
}

// Drive-time bucket palette — green→red gradient stays semantic so a user
// can scan the bar chart left-to-right and read time-cost intuitively.
// These hex values are deliberate (not theme-driven) so the gradient holds
// in both light and dark.
const BUCKET_COLORS: Record<string, string> = {
  under_30_min: '#22c55e',
  '30_to_60_min': '#84cc16',
  '60_to_90_min': '#eab308',
  '90_to_120_min': '#f97316',
  over_120_min: '#ef4444',
}

export default function DriveTimeChart({ data }: { data: DriveTimeOutputs }) {
  const theme = useChartTheme()
  const histogramData = Object.entries(data.drive_distribution).map(([key, count]) => ({
    key,
    label: BUCKET_LABELS[key] ?? key,
    count,
  }))

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
          Drive time distribution
        </h4>
        <div className="h-48 w-full">
          <ResponsiveContainer>
            <BarChart data={histogramData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={tickStyle(theme)}
                axisLine={{ stroke: theme.grid }}
                tickLine={false}
              />
              <YAxis tick={tickStyle(theme)} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: theme.grid, opacity: 0.4 }}
                contentStyle={tooltipStyle(theme)}
                formatter={(v: number) => [`${v} properties`, 'Count']}
              />
              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                {histogramData.map((d, i) => (
                  <Cell key={i} fill={BUCKET_COLORS[d.key] ?? theme.muted} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
          Cluster efficiency
        </h4>
        <div className="rounded-md border border-border bg-surface overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Branch</TableHead>
                <TableHead className="text-right">Properties</TableHead>
                <TableHead className="text-right">Avg drive (min)</TableHead>
                <TableHead className="text-right">Within 60 min</TableHead>
                <TableHead>Efficiency</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.cluster_efficiency.map((c) => (
                <TableRow key={c.branch}>
                  <TableCell className="font-medium text-fg">
                    {c.city_state ?? c.branch}
                  </TableCell>
                  <TableCell numeric>{c.property_count}</TableCell>
                  <TableCell numeric>{c.avg_drive_minutes}</TableCell>
                  <TableCell numeric>{c.properties_within_60min_pct}%</TableCell>
                  <TableCell>
                    <Badge variant={efficiencyVariant(c.efficiency_score)}>
                      {c.efficiency_score}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {data.long_drive_properties.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
            Long-drive properties ({data.long_drive_properties.length})
          </h4>
          <ul className="max-h-48 space-y-1.5 overflow-y-auto">
            {data.long_drive_properties.map((p) => (
              <li
                key={p.property_id}
                className="rounded-md border-l-2 border-danger bg-danger-subtle px-3 py-2 text-sm"
              >
                <p className="font-medium text-fg">{p.address}</p>
                <p className="text-xs text-fg-muted">
                  <span className="font-tabular">{p.drive_minutes}</span>
                  -min one-way drive
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function efficiencyVariant(
  score: 'high' | 'medium' | 'low'
): 'success' | 'warning' | 'danger' {
  if (score === 'high') return 'success'
  if (score === 'medium') return 'warning'
  return 'danger'
}
