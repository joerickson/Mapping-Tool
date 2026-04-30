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
import { TriangleAlert } from 'lucide-react'
import {
  CHART_CATEGORICAL,
  tickStyle,
  tooltipStyle,
  useChartTheme,
} from '../../hooks/useChartTheme'

interface StateRow {
  state: string
  property_count: number
  service_location_count: number
  total_sqft: number
  pct_of_portfolio: number
}

interface RegionRow {
  region_name: string
  states: string[]
  property_count: number
  centroid: { lat: number; lng: number }
}

interface Outlier {
  property_id: string
  address: string
  city: string
  state: string
  nearest_cluster_distance_miles: number
  nearest_cluster_region: string
  note: string
}

interface GeographicOutputs {
  states: StateRow[]
  regions: RegionRow[]
  outliers: Outlier[]
}

export default function GeographicChart({ data }: { data: GeographicOutputs }) {
  const theme = useChartTheme()
  const stateData = data.states.slice(0, 12)

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
          Properties by state (top 12)
        </h4>
        <div className="h-56 w-full">
          <ResponsiveContainer>
            <BarChart data={stateData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="state"
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
              <Bar dataKey="property_count" radius={[2, 2, 0, 0]}>
                {stateData.map((_, i) => (
                  <Cell key={i} fill={CHART_CATEGORICAL[i % CHART_CATEGORICAL.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
          Regions
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {data.regions.map((r) => (
            <div
              key={r.region_name}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
            >
              <p className="font-medium text-fg">{r.region_name}</p>
              <p className="text-xs text-fg-muted">
                <span className="font-tabular">{r.property_count}</span>{' '}
                {r.property_count === 1 ? 'property' : 'properties'}
                {r.states.length > 0 && ` · ${r.states.join(', ')}`}
              </p>
            </div>
          ))}
        </div>
      </section>

      {data.outliers.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
            Outliers ({data.outliers.length})
          </h4>
          <ul className="max-h-64 space-y-1.5 overflow-y-auto">
            {data.outliers.map((o) => (
              <li
                key={o.property_id}
                className="flex items-start gap-2 rounded-md border-l-2 border-warning bg-warning-subtle px-3 py-2 text-sm"
              >
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
                <div className="min-w-0">
                  <p className="font-medium text-fg">
                    {o.address}, {o.city}, {o.state}
                  </p>
                  <p className="text-xs text-fg-muted">{o.note}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
