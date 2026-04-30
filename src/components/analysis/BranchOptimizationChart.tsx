import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  CartesianGrid,
} from 'recharts'
import { ChevronDown } from 'lucide-react'
import { Badge } from '../ui/Badge'
import Button from '../ui/Button'
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

interface KResult {
  k: number
  branches: Array<{
    lat: number
    lng: number
    city_state: string
    city?: string | null
    state?: string | null
    population?: number | null
    population_band?: 'small' | 'medium' | 'large' | 'major' | null
    property_count: number
    total_sqft: number
    locked?: boolean
    source?: 'optimization' | 'locked'
    avg_drive_distance_miles: number
    max_drive_distance_miles: number
  }>
  total_annual_cost: number
  drive_cost: number
  branch_cost: number
  avg_drive_per_property: number
  is_elbow: boolean
}

interface BranchOptOutputs {
  k_results: KResult[]
  recommended_k: number
  floor_k?: number
  population_constraint?: {
    enabled: boolean
    min_population: number
    max_population: number | null
    state_filter: string[] | null
    eligible_city_count: number
  }
  unconstrained_reference?: Array<{
    k: number
    total_drive_cost: number
    centroids: Array<{
      lat: number
      lng: number
      nearest_city_unconstrained: string | null
      population: number | null
    }>
  }>
}

interface SelectionTableProps {
  onBuild?: (k: number) => void
  showTable?: boolean
  selectedK?: number | null
  selectedBranchNames?: string[] | null
}

export default function BranchOptimizationChart({
  data,
  onBuild,
  showTable,
  selectedK,
  selectedBranchNames,
}: { data: BranchOptOutputs } & SelectionTableProps) {
  const theme = useChartTheme()
  const recommended = data.k_results.find((r) => r.k === data.recommended_k)

  const recommendedBranchNames = recommended
    ? recommended.branches
        .slice()
        .sort((a, b) => b.property_count - a.property_count)
        .map((b) => b.city_state)
    : []
  const selectionDiffers =
    selectedK != null &&
    (selectedK !== data.recommended_k ||
      (selectedBranchNames &&
        selectedBranchNames.join('|') !== recommendedBranchNames.join('|')))

  return (
    <div className="space-y-6">
      {/* Recommended-vs-selected status banner */}
      {(selectedK != null || data.recommended_k > 0) && (
        <div
          className={cn(
            'rounded-md border px-4 py-3 text-sm',
            selectionDiffers
              ? 'border-warning/20 bg-warning-subtle'
              : 'border-accent/20 bg-accent-subtle'
          )}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                Optimization recommends
              </p>
              <p className="mt-0.5 font-semibold text-fg">
                K = <span className="font-tabular">{data.recommended_k}</span>
              </p>
              {recommendedBranchNames.length > 0 && (
                <p className="mt-0.5 text-xs text-fg-muted">
                  {recommendedBranchNames.join(' · ')}
                </p>
              )}
            </div>
            {selectedK != null && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                  You selected
                </p>
                <p className="mt-0.5 font-semibold text-fg">
                  K = <span className="font-tabular">{selectedK}</span>
                </p>
                {selectedBranchNames?.length ? (
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {selectedBranchNames.join(' · ')}
                  </p>
                ) : null}
              </div>
            )}
          </div>
          {selectionDiffers && (
            <p className="mt-3 border-t border-warning/20 pt-2 text-xs text-warning">
              Selection differs from current optimization recommendation. Re-run
              optimization to refresh, or update your selection if the new
              analysis suggests a better fit.
            </p>
          )}
        </div>
      )}

      <section className="space-y-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
          Annual cost by branch count (k) · recommended k ={' '}
          <span className="font-tabular">{data.recommended_k}</span>
        </h4>
        <div className="h-64 w-full">
          <ResponsiveContainer>
            <ComposedChart data={data.k_results} margin={{ top: 8, right: 8, left: -8, bottom: 8 }}>
              <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="k"
                tick={tickStyle(theme)}
                axisLine={{ stroke: theme.grid }}
                tickLine={false}
                label={{
                  value: 'k (# branches)',
                  position: 'insideBottom',
                  offset: -2,
                  fontSize: 11,
                  fill: theme.tick,
                }}
              />
              <YAxis
                yAxisId="cost"
                tick={tickStyle(theme)}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
              />
              <YAxis
                yAxisId="drive"
                orientation="right"
                tick={tickStyle(theme)}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `${v}mi`}
              />
              <Tooltip
                cursor={{ fill: theme.grid, opacity: 0.4 }}
                contentStyle={tooltipStyle(theme)}
                formatter={(value: number, name: string) => {
                  if (name === 'avg_drive_per_property')
                    return [`${value.toFixed(1)} mi`, 'Avg drive/property']
                  return [`$${value.toLocaleString()}`, name]
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: theme.tick }} />
              <ReferenceLine
                x={data.recommended_k}
                stroke={theme.success}
                strokeDasharray="3 3"
                yAxisId="cost"
              />
              {data.floor_k && data.floor_k > 0 && (
                <ReferenceLine
                  x={data.floor_k}
                  stroke={theme.danger}
                  strokeDasharray="2 4"
                  yAxisId="cost"
                  label={{
                    value: 'Floor (locked)',
                    fontSize: 10,
                    fill: theme.danger,
                  }}
                />
              )}
              <Bar
                yAxisId="cost"
                dataKey="drive_cost"
                stackId="a"
                fill={theme.accent}
                name="Drive cost"
              />
              <Bar
                yAxisId="cost"
                dataKey="branch_cost"
                stackId="a"
                fill="#a855f7"
                name="Branch cost"
              >
                {data.k_results.map((r, i) => (
                  <Cell key={i} fill={r.is_elbow ? theme.success : '#a855f7'} />
                ))}
              </Bar>
              <Line
                yAxisId="drive"
                type="monotone"
                dataKey="avg_drive_per_property"
                stroke={theme.warning}
                strokeWidth={2}
                dot={{ r: 3 }}
                name="Avg drive/property (mi)"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      {recommended && (
        <section className="space-y-2">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
            Recommended branches (k = {recommended.k})
          </h4>
          <div className="rounded-md border border-border bg-surface overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Population</TableHead>
                  <TableHead className="text-right">Properties</TableHead>
                  <TableHead className="text-right">Total sqft</TableHead>
                  <TableHead className="text-right">Avg drive (mi)</TableHead>
                  <TableHead className="text-right">Max drive (mi)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recommended.branches
                  .slice()
                  .sort((a, b) => b.property_count - a.property_count)
                  .map((b, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium text-fg">
                        <span className="inline-flex items-center gap-2">
                          {b.city_state}
                          {b.locked && <Badge variant="accent">locked</Badge>}
                        </span>
                      </TableCell>
                      <TableCell numeric className="text-fg-muted">
                        {formatPop(b.population)}
                      </TableCell>
                      <TableCell numeric>{b.property_count}</TableCell>
                      <TableCell numeric>{b.total_sqft.toLocaleString()}</TableCell>
                      <TableCell numeric>{b.avg_drive_distance_miles}</TableCell>
                      <TableCell numeric>{b.max_drive_distance_miles}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      {/* Per-K selection table */}
      {showTable && onBuild && (
        <section className="space-y-2">
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              Pick a branch count to build your selection
            </h4>
            <p className="mt-1 text-xs text-fg-muted">
              Each row shows the modeled cost at K branches. Click a row's button to
              start building your selection — you'll specify the actual locations
              manually.
            </p>
          </div>
          <div className="rounded-md border border-border bg-surface overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>K</TableHead>
                  <TableHead className="text-right">Total $/yr</TableHead>
                  <TableHead className="text-right">Drive</TableHead>
                  <TableHead className="text-right">Branch</TableHead>
                  <TableHead className="text-right">Avg drive (mi)</TableHead>
                  <TableHead>Optimization-suggested centroids</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.k_results.map((r) => {
                  const isRec = r.k === data.recommended_k
                  return (
                    <TableRow
                      key={r.k}
                      className={isRec ? 'bg-success-subtle/40' : undefined}
                    >
                      <TableCell className="font-mono font-semibold text-fg">
                        <span className="inline-flex items-center gap-1.5">
                          {r.k}
                          {isRec && <Badge variant="success">Recommended</Badge>}
                        </span>
                      </TableCell>
                      <TableCell numeric className="text-fg">
                        ${r.total_annual_cost.toLocaleString()}
                      </TableCell>
                      <TableCell numeric className="text-fg-muted">
                        ${r.drive_cost.toLocaleString()}
                      </TableCell>
                      <TableCell numeric className="text-fg-muted">
                        ${r.branch_cost.toLocaleString()}
                      </TableCell>
                      <TableCell numeric className="text-fg-muted">
                        {r.avg_drive_per_property}
                      </TableCell>
                      <TableCell className="text-xs text-fg-muted">
                        {r.branches.map((b) => b.city_state).join(' · ')}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" onClick={() => onBuild(r.k)}>
                          Build K={r.k} →
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      {/* Population constraint info + unconstrained reference */}
      {data.population_constraint && (
        <section className="border-t border-border pt-4 space-y-2">
          <p className="text-xs text-fg-muted">
            {data.population_constraint.enabled ? (
              <>
                Population constraint:{' '}
                <span className="font-semibold text-fg">
                  min{' '}
                  <span className="font-tabular">
                    {data.population_constraint.min_population.toLocaleString()}
                  </span>
                </span>
                {data.population_constraint.state_filter?.length ? (
                  <> · states: {data.population_constraint.state_filter.join(', ')}</>
                ) : null}
                {' · '}
                <span className="font-tabular">
                  {data.population_constraint.eligible_city_count.toLocaleString()}
                </span>{' '}
                eligible cities in range
              </>
            ) : (
              <>Population constraint disabled — using unconstrained k-means.</>
            )}
          </p>

          {data.unconstrained_reference && data.unconstrained_reference.length > 0 && (
            <details className="group">
              <summary
                className={cn(
                  'flex cursor-pointer items-center gap-1.5 text-xs font-medium text-fg-muted',
                  'hover:text-fg list-none [&::-webkit-details-marker]:hidden'
                )}
              >
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-0 -rotate-90" />
                View unconstrained reference (what pure k-means would have suggested)
              </summary>
              <ul className="mt-2 space-y-2">
                {data.unconstrained_reference.map((u) => (
                  <li
                    key={u.k}
                    className="rounded-md border border-border bg-surface-subtle px-3 py-2"
                  >
                    <p className="font-mono text-xs text-fg">
                      k=<span className="font-tabular">{u.k}</span> — drive cost
                      ${u.total_drive_cost.toLocaleString()}
                    </p>
                    <p className="mt-0.5 text-xs text-fg-muted">
                      Centroids near:{' '}
                      {u.centroids
                        .map(
                          (c) =>
                            `${
                              c.nearest_city_unconstrained ??
                              `${c.lat.toFixed(2)},${c.lng.toFixed(2)}`
                            }${c.population != null ? ` (${formatPop(c.population)})` : ''}`
                        )
                        .join(' · ')}
                    </p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </div>
  )
}

function formatPop(p: number | null | undefined): string {
  if (p == null) return '—'
  if (p >= 1_000_000) return `${(p / 1_000_000).toFixed(1)}M`
  if (p >= 1000) return `${(p / 1000).toFixed(0)}K`
  return p.toString()
}
