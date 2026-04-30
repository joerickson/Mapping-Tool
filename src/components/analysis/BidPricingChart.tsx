import { useState } from 'react'
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
import { Card } from '../ui/Card'
import Button from '../ui/Button'
import {
  CHART_CATEGORICAL,
  tickStyle,
  tooltipStyle,
  useChartTheme,
} from '../../hooks/useChartTheme'
import OvernightBreakdownDrawer from './OvernightBreakdownDrawer'

interface BidOutputs {
  property_count: number
  total_sqft: number
  sourced_from: {
    crew_strategy_option: string | null
    crew_count: number | null
    branch_count: number | null
    fte_count: number | null
    source?: 'scheduler_template' | 'crew_strategy_estimate' | 'manual_override'
    scheduler_template?: { id: string; name: string } | null
  }
  cost_buildup: {
    direct_labor: number
    vehicle_fuel: number
    vehicle_lease: number
    // Phase 3.7 — hotels is emitted as a structured object so the UI can
    // surface the basis (calculated / override / flat_fallback) and the
    // night/cluster breakdown. Older outputs (or the flat_fallback path)
    // may be a bare { total, basis }.
    hotels:
      | number
      | {
          total: number
          basis?: 'calculated' | 'override' | 'flat_fallback'
          calculated_value?: number
          hotel_room_cost?: number
          per_diem_cost?: number
          breakdown?: {
            total_nights: number
            cost_per_night: number
            crew_size: number
            per_diem_per_night: number
            cluster_count: number
            properties_requiring_overnight: number
          }
        }
    supplies: number
    // Phase 3.9 — branch_overhead, insurance, vehicle_costs are now
    // structured (calculated breakdown vs flat override). Old outputs
    // remain bare numbers; the chart accepts either.
    branch_overhead:
      | number
      | {
          total: number
          basis?: 'calculated' | 'override'
          breakdown?: {
            main_count: number
            satellite_count: number
            per_branch?: Array<{
              branch_name: string
              branch_type: 'main' | 'satellite'
              total_annual: number
            }>
            total: number
          }
        }
    insurance:
      | number
      | {
          total: number
          basis?: 'calculated' | 'override'
          breakdown?: {
            method: string
            applied_percentage: number
            basis_amount: number
            hit_minimum: boolean
            breakdown_text: string
          }
        }
    vehicle_costs?:
      | {
          total: number
          basis?: 'calculated' | 'override'
          breakdown?: {
            per_crew?: Array<{
              crew_label: string
              total_annual: number
              vehicles: Array<{ ownership_type: string; annual_cost: number }>
            }>
            total: number
            fuel_excluded_crew_labels?: string[]
          }
        }
    total_direct_cost: number
  }
  indirect_cost: { corporate_overhead: number }
  total_cost: number
  margin: { target_pct: number; margin_amount: number }
  bid_total: number
  bid_per_property: number
  // Phase 3.9 — per-service-line $/sqft replaces the consolidated
  // bid_per_sqft. Project lines (project_clean, upholstery) report
  // unit='visit'; recurring janitorial reports unit='year' but is
  // out of scope of this bid model and shows note + rate_per_sqft=null.
  per_service_line?: Array<{
    service_line: 'project_clean' | 'upholstery' | 'recurring_janitorial' | 'other'
    label: string
    unit: 'visit' | 'year'
    sl_count: number
    sqft: number
    visit_sqft: number | null
    avg_visits_per_year: number | null
    annual_work_hours: number | null
    allocated_annual_cost: number | null
    rate_per_sqft: number | null
    in_scope: boolean
    note: string | null
  }>
  monthly_invoice_estimate: number
  cost_breakdown_pct: {
    labor: number
    vehicle: number
    overhead: number
    margin: number
    other: number
  }
}

const ROW_LABELS: Record<string, string> = {
  direct_labor: 'Direct labor',
  vehicle_fuel: 'Vehicle fuel',
  vehicle_lease: 'Vehicle lease',
  hotels: 'Hotels',
  supplies: 'Supplies',
  branch_overhead: 'Branch overhead',
  insurance: 'Insurance',
  corporate_overhead: 'Corporate overhead',
  margin: 'Margin',
}

interface BidPricingChartProps {
  data: BidOutputs
  // When provided, the hotels row exposes a "View calculation" button
  // that opens the OvernightBreakdownDrawer with override controls.
  accountId?: string
  clientId?: string
  onHotelsOverridden?: () => void
}

export default function BidPricingChart({
  data,
  accountId,
  clientId,
  onHotelsOverridden,
}: BidPricingChartProps) {
  const [hotelsOpen, setHotelsOpen] = useState(false)
  const theme = useChartTheme()
  // Phase 3.7 — hotels is a structured object now; pull the dollar total
  // out of it (older bare-number outputs still work).
  const hotelsValue =
    typeof data.cost_buildup.hotels === 'number'
      ? data.cost_buildup.hotels
      : (data.cost_buildup.hotels?.total ?? 0)
  const hotelsObj =
    typeof data.cost_buildup.hotels === 'object' ? data.cost_buildup.hotels : null
  // Phase 3.9 — branch_overhead / insurance / vehicle_costs may be
  // structured objects. Extract totals + keep refs for diagnostic
  // strings.
  const branchOverheadValue =
    typeof data.cost_buildup.branch_overhead === 'number'
      ? data.cost_buildup.branch_overhead
      : (data.cost_buildup.branch_overhead?.total ?? 0)
  const branchOverheadObj =
    typeof data.cost_buildup.branch_overhead === 'object'
      ? data.cost_buildup.branch_overhead
      : null
  const insuranceValue =
    typeof data.cost_buildup.insurance === 'number'
      ? data.cost_buildup.insurance
      : (data.cost_buildup.insurance?.total ?? 0)
  const insuranceObj =
    typeof data.cost_buildup.insurance === 'object'
      ? data.cost_buildup.insurance
      : null
  const vehicleCostsObj = data.cost_buildup.vehicle_costs ?? null
  const buildupRows = [
    { key: 'direct_labor', value: data.cost_buildup.direct_labor },
    { key: 'vehicle_fuel', value: data.cost_buildup.vehicle_fuel },
    { key: 'vehicle_lease', value: data.cost_buildup.vehicle_lease },
    { key: 'hotels', value: hotelsValue },
    { key: 'supplies', value: data.cost_buildup.supplies },
    { key: 'branch_overhead', value: branchOverheadValue },
    { key: 'insurance', value: insuranceValue },
    { key: 'corporate_overhead', value: data.indirect_cost.corporate_overhead },
    { key: 'margin', value: data.margin.margin_amount },
    // Always keep hotels in the table even at $0 so the diagnostic ("0
    // overnight trips found") is visible — that's usually the bug.
  ].filter((r) => r.value > 0 || r.key === 'hotels')

  // Phase 3.8 — source-of-truth indicator for the headline bid number.
  const source = data.sourced_from.source ?? null
  const sourceLine = (() => {
    if (source === 'scheduler_template') {
      const name = data.sourced_from.scheduler_template?.name ?? 'active template'
      return {
        label: `Scheduler optimization (high confidence)`,
        sub: `Crew count from active template "${name}".`,
        tone: 'success' as const,
      }
    }
    if (source === 'manual_override') {
      return {
        label: 'Manual override',
        sub: 'Crew count + costs entered manually.',
        tone: 'neutral' as const,
      }
    }
    return {
      label: 'Crew strategy estimate (run scheduler for actual numbers)',
      sub: 'Pre-scheduler estimate from building-count math.',
      tone: 'warn' as const,
    }
  })()

  return (
    <div className="space-y-6">
      {/* Source-of-truth indicator */}
      <div
        className={
          'rounded-md border px-3 py-2 text-xs ' +
          (sourceLine.tone === 'success'
            ? 'border-success/30 bg-success/5 text-success'
            : sourceLine.tone === 'warn'
              ? 'border-warning/30 bg-warning/5 text-warning'
              : 'border-border bg-surface-subtle text-fg-muted')
        }
      >
        <p className="font-semibold">
          {sourceLine.tone === 'success' ? '✓ ' : sourceLine.tone === 'warn' ? '⚠ ' : ''}
          Source: {sourceLine.label}
        </p>
        <p className="mt-0.5 text-fg-muted">{sourceLine.sub}</p>
      </div>

      {/* Headline bid number — quiet 1px-bordered card per design rules
          (the legacy version used a green→teal gradient + 2px border which
          shouted; we let the typography do the work instead). */}
      <Card padding="md">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
          Recommended bid
        </p>
        <p className="mt-1 leading-none">
          <span className="font-mono text-4xl font-semibold tabular-nums text-fg">
            ${(data.bid_total / 1_000_000).toFixed(2)}M
          </span>
          <span className="ml-2 text-base text-fg-muted">/year</span>
        </p>
        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <BidStat
            label="Per property"
            value={`$${data.bid_per_property.toLocaleString()}`}
          />
          <BidStat
            label="Monthly invoice"
            value={`$${data.monthly_invoice_estimate.toLocaleString()}`}
          />
        </div>

        {/* Per-service-line $/sqft. Project lines = $/sqft/visit;
            recurring janitorial = $/sqft/year (when scoped). */}
        {data.per_service_line && data.per_service_line.length > 0 && (
          <div className="mt-5 pt-4 border-t border-border space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              $/sqft by service line
            </p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {data.per_service_line.map((line) => (
                <li
                  key={line.service_line}
                  className="rounded-md border border-border bg-surface-subtle/40 px-3 py-2"
                >
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <span className="text-xs font-medium text-fg">{line.label}</span>
                    {line.rate_per_sqft != null ? (
                      <span className="font-mono text-base font-semibold tabular-nums text-fg">
                        ${line.rate_per_sqft.toFixed(2)}
                        <span className="text-xs text-fg-muted ml-1">
                          /sqft/{line.unit}
                        </span>
                      </span>
                    ) : (
                      <span className="text-xs text-fg-subtle italic">not priced</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-fg-muted">
                    <span className="font-tabular">{line.sl_count}</span> SLs ·{' '}
                    <span className="font-tabular">{line.sqft.toLocaleString()}</span> sqft
                    {line.avg_visits_per_year != null && line.unit === 'visit' && (
                      <>
                        {' · '}
                        <span className="font-tabular">{line.avg_visits_per_year}</span>×/yr avg
                      </>
                    )}
                  </p>
                  {line.note && (
                    <p className="mt-1 text-[11px] text-fg-subtle italic">{line.note}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* Cost buildup bars */}
      <section className="space-y-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
          Cost buildup
        </h4>
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <BarChart
              data={buildupRows.map((r) => ({ ...r, name: ROW_LABELS[r.key] }))}
              layout="vertical"
              margin={{ top: 4, right: 8, left: 100, bottom: 0 }}
            >
              <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number"
                tick={tickStyle(theme)}
                axisLine={{ stroke: theme.grid }}
                tickLine={false}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={tickStyle(theme)}
                axisLine={false}
                tickLine={false}
                width={140}
              />
              <Tooltip
                cursor={{ fill: theme.grid, opacity: 0.4 }}
                contentStyle={tooltipStyle(theme)}
                formatter={(v: number) => [`$${v.toLocaleString()}`, 'Amount']}
              />
              <Bar dataKey="value" radius={[0, 2, 2, 0]}>
                {buildupRows.map((_, i) => (
                  <Cell key={i} fill={CHART_CATEGORICAL[i % CHART_CATEGORICAL.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Detailed breakdown */}
      <section className="space-y-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
          Detailed breakdown
        </h4>
        <ul className="divide-y divide-border rounded-md border border-border bg-surface">
          {buildupRows.map((r) => (
            <li
              key={r.key}
              className="flex items-center justify-between px-4 py-2 text-sm"
            >
              <span className="text-fg-muted">
                {ROW_LABELS[r.key]}
                {r.key === 'hotels' && hotelsObj?.breakdown && (
                  <span className="ml-2 text-xs text-fg-subtle">
                    ({hotelsObj.basis ?? 'calculated'}
                    {hotelsObj.breakdown.total_nights > 0
                      ? ` · ${hotelsObj.breakdown.total_nights} nights · ${hotelsObj.breakdown.cluster_count} cluster${hotelsObj.breakdown.cluster_count === 1 ? '' : 's'} · ${hotelsObj.breakdown.properties_requiring_overnight} prop${hotelsObj.breakdown.properties_requiring_overnight === 1 ? '' : 's'} @ $${hotelsObj.breakdown.cost_per_night}/night`
                      : ` · 0 overnight trips found — verify branches + overnight_trigger_one_way_hours`}
                    )
                  </span>
                )}
                {r.key === 'branch_overhead' && branchOverheadObj?.breakdown && (
                  <span className="ml-2 text-xs text-fg-subtle">
                    ({branchOverheadObj.basis ?? 'calculated'} · {branchOverheadObj.breakdown.main_count} main · {branchOverheadObj.breakdown.satellite_count} satellite)
                  </span>
                )}
                {r.key === 'insurance' && insuranceObj?.breakdown && (
                  <span className="ml-2 text-xs text-fg-subtle">
                    ({insuranceObj.breakdown.method === 'percentage_of_revenue'
                      ? `${insuranceObj.breakdown.applied_percentage}% × $${insuranceObj.breakdown.basis_amount.toLocaleString()}${insuranceObj.breakdown.hit_minimum ? ' · hit minimum' : ''}`
                      : 'flat amount'})
                  </span>
                )}
                {r.key === 'vehicle_lease' && vehicleCostsObj?.breakdown && (
                  <span className="ml-2 text-xs text-fg-subtle">
                    ({vehicleCostsObj.basis ?? 'calculated'} · {vehicleCostsObj.breakdown.per_crew?.length ?? 0} crews
                    {vehicleCostsObj.breakdown.fuel_excluded_crew_labels && vehicleCostsObj.breakdown.fuel_excluded_crew_labels.length > 0 && (
                      <> · {vehicleCostsObj.breakdown.fuel_excluded_crew_labels.length} on personal vehicle</>
                    )})
                  </span>
                )}
                {r.key === 'hotels' && accountId && clientId && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setHotelsOpen(true)}
                    className="ml-2"
                  >
                    View calculation
                  </Button>
                )}
              </span>
              <span className="font-mono tabular-nums text-fg">
                ${r.value.toLocaleString()}
              </span>
            </li>
          ))}
          <li className="flex items-center justify-between border-t-2 border-border-strong px-4 py-2.5 text-sm">
            <span className="font-semibold text-fg">Total bid</span>
            <span className="font-mono text-base font-semibold tabular-nums text-fg">
              ${data.bid_total.toLocaleString()}
            </span>
          </li>
        </ul>
      </section>

      {/* Composition pct */}
      <section className="space-y-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
          Bid composition
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <CompCard label="Labor" pct={data.cost_breakdown_pct.labor} color={theme.accent} />
          <CompCard
            label="Vehicle / fuel"
            pct={data.cost_breakdown_pct.vehicle}
            color="#0891b2"
          />
          <CompCard label="Overhead" pct={data.cost_breakdown_pct.overhead} color="#a855f7" />
          <CompCard label="Margin" pct={data.cost_breakdown_pct.margin} color={theme.success} />
        </div>
      </section>

      {data.sourced_from.crew_strategy_option && (
        <p className="border-t border-border pt-3 text-xs italic text-fg-subtle">
          Labor sourced from Crew Strategy Option{' '}
          <span className="font-mono not-italic">{data.sourced_from.crew_strategy_option}</span>{' '}
          · <span className="font-tabular not-italic">{data.sourced_from.crew_count}</span> crews
          · <span className="font-tabular not-italic">{data.sourced_from.branch_count}</span> branches
        </p>
      )}

      {accountId && clientId && (
        <OvernightBreakdownDrawer
          open={hotelsOpen}
          onClose={() => setHotelsOpen(false)}
          accountId={accountId}
          clientId={clientId}
          onOverrideSaved={onHotelsOverridden}
        />
      )}
    </div>
  )
}

function BidStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-fg">
        {value}
      </p>
    </div>
  )
}

function CompCard({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-fg">
        {pct}%
      </p>
      <div className="mt-1.5 h-1 overflow-hidden rounded bg-surface-muted">
        <div
          className="h-full"
          style={{ width: `${Math.min(100, pct)}%`, background: color }}
        />
      </div>
    </div>
  )
}
