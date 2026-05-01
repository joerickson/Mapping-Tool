import { useEffect, useState } from 'react'
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
import { ChevronDown, Loader2, Lock, Pencil, RotateCcw } from 'lucide-react'
import { Card } from '../ui/Card'
import Button from '../ui/Button'
import { Input } from '../ui/Input'
import {
  CHART_CATEGORICAL,
  tickStyle,
  tooltipStyle,
  useChartTheme,
} from '../../hooks/useChartTheme'
import { useAuth } from '../../hooks/useAuth'
import { cn } from '../../lib/cn'
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
  // Phase 4 follow-up — offerings the client serves but that have no
  // pricing config (or config with zero rate). When non-empty, the
  // service-line breakdown total is structurally lower than the
  // headline bid; UI surfaces a banner.
  unpriced_offerings?: Array<{
    offering_id: string
    offering_name: string
    sl_count: number
    total_sqft: number
    reason: 'no_config' | 'zero_rate'
  }>
  // Phase 4 — service line bid pricing structure. Per-line revenue/cost/
  // margin computed from configured rates × billable sqft, with shared
  // overhead allocated by revenue share.
  service_line_bid?: {
    service_lines: Array<{
      offering_id: string
      offering_name: string
      pricing_model: 'per_visit_blended_sqft' | 'per_sqft_monthly'
      rate: number
      rate_label: string
      billable_sqft_pct: number
      property_count: number
      total_sqft_raw: number
      total_sqft_billable: number
      total_visits_per_year: number
      annual_revenue: number
      monthly_revenue: number
      total_cost: number
      target_gross_margin_pct: number
      actual_gross_margin_dollars: number
      actual_gross_margin_pct: number
      margin_below_target: boolean
      warnings: string[]
    }>
    summary: {
      total_annual_revenue: number
      total_annual_cost: number
      total_gross_profit: number
      weighted_average_margin_pct: number
      service_line_count: number
      properties_total: number
    }
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
  // Phase 4.2 — fired after any inline edit (rate, percentage, etc.)
  // saves so the parent can re-run the bid pricing module. Defaults
  // to the same callback as onHotelsOverridden when not provided.
  onChanged?: () => void
}

export default function BidPricingChart({
  data,
  accountId,
  clientId,
  onHotelsOverridden,
  onChanged,
}: BidPricingChartProps) {
  const [hotelsOpen, setHotelsOpen] = useState(false)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const theme = useChartTheme()
  const triggerReRun = onChanged ?? onHotelsOverridden
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

  // Reconciliation between headline bid (cost-buildup math) and
  // service-line breakdown (rate × billable sqft × frequency). When
  // they diverge by >10%, surface a banner. Most common cause: some
  // offerings have SLs but no entry in service_line_pricing_config,
  // so they're invisible to the breakdown.
  const headlineBid = data.bid_total
  const serviceLineRevenue = data.service_line_bid?.summary.total_annual_revenue ?? 0
  const reconciliationGapPct =
    headlineBid > 0 ? Math.abs(headlineBid - serviceLineRevenue) / headlineBid : 0
  const showReconciliation =
    !!data.service_line_bid &&
    serviceLineRevenue > 0 &&
    (reconciliationGapPct > 0.1 || (data.unpriced_offerings ?? []).length > 0)
  const showAllUnpriced =
    !data.service_line_bid && (data.unpriced_offerings ?? []).length > 0

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

      {/* Reconciliation banner — fires when the service-line breakdown
          excludes offerings the client is actually serving, so the
          breakdown total looks much smaller than the headline bid. */}
      {(showReconciliation || showAllUnpriced) && (
        <div className="rounded-md border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
          <p className="font-semibold text-warning">
            ⚠ Service line breakdown is incomplete
          </p>
          {showReconciliation && (
            <p className="mt-1 text-fg-muted">
              Headline bid is{' '}
              <span className="font-mono font-semibold text-fg">
                ${headlineBid.toLocaleString()}
              </span>{' '}
              but the service-line breakdown sums to{' '}
              <span className="font-mono font-semibold text-fg">
                ${serviceLineRevenue.toLocaleString()}
              </span>{' '}
              — a <span className="font-tabular">{Math.round(reconciliationGapPct * 100)}%</span> gap.
            </p>
          )}
          {showAllUnpriced && (
            <p className="mt-1 text-fg-muted">
              No service-line pricing is configured. The headline bid is computed
              from the cost-buildup math (labor + overhead + margin) only.
            </p>
          )}
          {(data.unpriced_offerings ?? []).length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-fg">
                {data.unpriced_offerings!.length} offering
                {data.unpriced_offerings!.length === 1 ? '' : 's'} {' '}
                are not priced and contribute $0 to the breakdown:
              </p>
              <ul className="mt-1 ml-4 list-disc text-xs text-fg-muted space-y-0.5">
                {data.unpriced_offerings!.slice(0, 8).map((u) => (
                  <li key={u.offering_id}>
                    <span className="text-fg">{u.offering_name}</span>{' '}
                    — {u.sl_count} SL{u.sl_count === 1 ? '' : 's'},{' '}
                    {u.total_sqft.toLocaleString()} sqft (
                    {u.reason === 'no_config' ? 'no pricing config' : 'rate is $0'}
                    )
                  </li>
                ))}
                {data.unpriced_offerings!.length > 8 && (
                  <li className="italic">
                    +{data.unpriced_offerings!.length - 8} more
                  </li>
                )}
              </ul>
              <p className="mt-2 text-xs text-fg-muted">
                Set rates in <span className="font-medium">Cost Assumptions → Service line pricing</span>{' '}
                to bring these into the breakdown.
              </p>
            </div>
          )}
        </div>
      )}

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
            recurring janitorial = $/sqft/year (when scoped or
            configured via Phase 4). */}
        {data.per_service_line && data.per_service_line.length > 0 && (
          <div className="mt-5 pt-4 border-t border-border space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              $/sqft by service line
            </p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {data.per_service_line.map((line) => {
                // When a Phase 4 config exists for this category,
                // prefer its rate over the bid-allocation math. Maps
                // category → average rate from service_line_bid lines
                // whose offering name fits.
                const sib = data.service_line_bid?.service_lines ?? []
                const categoryMatch = sib.find((s) => {
                  const n = s.offering_name.toLowerCase()
                  if (line.service_line === 'project_clean')
                    return /project clean/.test(n) && !/upholstery/.test(n)
                  if (line.service_line === 'upholstery') return /upholstery/.test(n)
                  if (line.service_line === 'recurring_janitorial')
                    return /recurring janitorial|housekeeping|home cleaning/.test(n)
                  return false
                })
                const phase4Rate = categoryMatch?.rate ?? null
                const phase4Unit = categoryMatch
                  ? categoryMatch.pricing_model === 'per_sqft_monthly'
                    ? 'month'
                    : 'visit'
                  : null

                const displayRate = phase4Rate != null && phase4Rate > 0
                  ? phase4Rate
                  : line.rate_per_sqft
                const displayUnit = phase4Unit ?? line.unit
                const isTrulyZero =
                  displayRate == null || displayRate < 0.005

                return (
                  <li
                    key={line.service_line}
                    className="rounded-md border border-border bg-surface-subtle/40 px-3 py-2"
                  >
                    <div className="flex items-baseline justify-between gap-2 flex-wrap">
                      <span className="text-xs font-medium text-fg">{line.label}</span>
                      {!isTrulyZero ? (
                        <span className="font-mono text-base font-semibold tabular-nums text-fg">
                          ${displayRate!.toFixed(2)}
                          <span className="text-xs text-fg-muted ml-1">
                            /sqft/{displayUnit}
                          </span>
                        </span>
                      ) : (
                        <span
                          className="text-xs text-fg-subtle italic"
                          title={
                            line.rate_per_sqft == null
                              ? 'No rate is configured for this service line'
                              : 'Rate rounds below $0.01/sqft — likely no contributing hours or sqft'
                          }
                        >
                          —
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-fg-muted">
                      <span className="font-tabular">{line.sl_count}</span> SLs ·{' '}
                      <span className="font-tabular">{line.sqft.toLocaleString()}</span> sqft
                      {line.avg_visits_per_year != null && displayUnit === 'visit' && (
                        <>
                          {' · '}
                          <span className="font-tabular">{line.avg_visits_per_year}</span>×/yr avg
                        </>
                      )}
                    </p>
                    {phase4Rate != null && phase4Rate > 0 && (
                      <p className="mt-0.5 text-[10px] text-accent">
                        ✓ Rate from Service Line Pricing config
                      </p>
                    )}
                    {phase4Rate == null && line.note && (
                      <p className="mt-1 text-[11px] text-fg-subtle italic">{line.note}</p>
                    )}
                    {isTrulyZero && phase4Rate == null && line.rate_per_sqft != null && (
                      <p className="mt-1 text-[11px] text-warning">
                        Set a rate in Cost Assumptions → Service line pricing
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </Card>

      {/* Phase 4 — Per-service-line bid summary */}
      {data.service_line_bid && data.service_line_bid.service_lines.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              Service line bid breakdown
            </h4>
            <p className="text-xs text-fg-muted">
              Total revenue:{' '}
              <span className="font-mono tabular-nums text-fg">
                ${data.service_line_bid.summary.total_annual_revenue.toLocaleString()}
              </span>
              {' · '}
              Weighted margin:{' '}
              <span className="font-mono tabular-nums text-fg">
                {data.service_line_bid.summary.weighted_average_margin_pct.toFixed(1)}%
              </span>
            </p>
          </div>
          <ul className="divide-y divide-border rounded-md border border-border bg-surface">
            {data.service_line_bid.service_lines.map((line) => (
              <li key={line.offering_id} className="px-4 py-3 text-sm space-y-1">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="font-medium text-fg">{line.offering_name}</p>
                    <p className="text-xs text-fg-muted mt-0.5">
                      {line.rate_label}
                      {' · '}
                      <span className="font-tabular">{line.property_count}</span> SLs
                      {' · '}
                      <span className="font-tabular">
                        {line.total_sqft_billable.toLocaleString()}
                      </span>{' '}
                      billable sqft
                      {line.billable_sqft_pct < 100 && (
                        <span className="text-fg-subtle">
                          {' '}
                          ({line.billable_sqft_pct}% of {line.total_sqft_raw.toLocaleString()})
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-base font-semibold tabular-nums text-fg">
                      ${line.annual_revenue.toLocaleString()}
                      <span className="text-xs text-fg-muted ml-1">/yr</span>
                    </p>
                    <p
                      className={
                        'text-xs font-tabular ' +
                        (line.margin_below_target ? 'text-warning' : 'text-fg-muted')
                      }
                    >
                      {line.actual_gross_margin_pct.toFixed(1)}% margin
                      {line.margin_below_target && ' ⚠ below target'}
                    </p>
                  </div>
                </div>
                <p className="text-[11px] text-fg-subtle font-tabular">
                  Cost ${line.total_cost.toLocaleString()} · Profit $
                  {line.actual_gross_margin_dollars.toLocaleString()} · Target{' '}
                  {line.target_gross_margin_pct}%
                </p>
                {line.warnings.length > 0 && (
                  <p className="text-[11px] text-warning italic">
                    {line.warnings.join(' · ')}
                  </p>
                )}
              </li>
            ))}
            <li className="flex items-center justify-between border-t-2 border-border-strong px-4 py-2.5 text-sm bg-surface-subtle/40">
              <span className="font-semibold text-fg">Total</span>
              <span className="font-mono text-base font-semibold tabular-nums text-fg">
                ${data.service_line_bid.summary.total_annual_revenue.toLocaleString()}
                <span className="text-xs text-fg-muted ml-2">
                  ({data.service_line_bid.summary.weighted_average_margin_pct.toFixed(1)}%
                  margin)
                </span>
              </span>
            </li>
          </ul>
        </section>
      )}

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

      {/* Detailed breakdown — Phase 4.2 expandable rows. */}
      <section className="space-y-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
          Detailed breakdown
        </h4>
        <ul className="divide-y divide-border rounded-md border border-border bg-surface">
          {buildupRows.map((r) => {
            const isOpen = expandedRow === r.key
            const inlineMeta = (() => {
              if (r.key === 'hotels' && hotelsObj?.breakdown) {
                return hotelsObj.breakdown.total_nights > 0
                  ? `${hotelsObj.breakdown.total_nights} nights · ${hotelsObj.breakdown.cluster_count} cluster${hotelsObj.breakdown.cluster_count === 1 ? '' : 's'} · $${hotelsObj.breakdown.cost_per_night}/night`
                  : `0 overnight trips found`
              }
              if (r.key === 'branch_overhead' && branchOverheadObj?.breakdown) {
                return `${branchOverheadObj.breakdown.main_count} main · ${branchOverheadObj.breakdown.satellite_count} satellite`
              }
              if (r.key === 'insurance' && insuranceObj?.breakdown) {
                return insuranceObj.breakdown.method === 'percentage_of_revenue'
                  ? `${insuranceObj.breakdown.applied_percentage}% × revenue${insuranceObj.breakdown.hit_minimum ? ' · hit minimum' : ''}`
                  : 'flat amount'
              }
              if (r.key === 'vehicle_lease' && vehicleCostsObj?.breakdown) {
                return `${vehicleCostsObj.breakdown.per_crew?.length ?? 0} crews${
                  vehicleCostsObj.breakdown.fuel_excluded_crew_labels?.length
                    ? ` · ${vehicleCostsObj.breakdown.fuel_excluded_crew_labels.length} personal vehicle`
                    : ''
                }`
              }
              return null
            })()
            return (
              <li key={r.key}>
                <button
                  type="button"
                  onClick={() => setExpandedRow(isOpen ? null : r.key)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-surface-subtle/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
                >
                  <span className="flex items-center gap-2 text-fg-muted text-left">
                    <ChevronDown
                      className={cn(
                        'h-3 w-3 text-fg-subtle transition-transform',
                        isOpen && 'rotate-180'
                      )}
                    />
                    {ROW_LABELS[r.key]}
                    {inlineMeta && (
                      <span className="text-xs text-fg-subtle">({inlineMeta})</span>
                    )}
                  </span>
                  <span className="font-mono tabular-nums text-fg">
                    ${r.value.toLocaleString()}
                  </span>
                </button>
                {isOpen && (
                  <BidLineDetail
                    rowKey={r.key}
                    rowValue={r.value}
                    accountId={accountId}
                    clientId={clientId}
                    onOpenHotels={() => setHotelsOpen(true)}
                    onChanged={triggerReRun}
                  />
                )}
              </li>
            )
          })}
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

// Phase 4.2 — per-row expanded calculation panel. Shows the formula
// inputs with editable rate fields, locked indicators (with their
// source module + a scroll/anchor link), and drawer launchers for
// structured breakdowns. All saves PATCH /operational-constraints
// then call onChanged so the parent re-runs the bid pricing module.
type EditableSpec = {
  field: string                  // operational-constraints column
  jsonbContainer?: string         // for fields nested inside a jsonb column
  jsonbKey?: string
  label: string
  unit: 'currency' | 'currency-per-mile' | 'percent-decimal' | 'percent-whole'
  step?: string
}
type LockedSpec = {
  label: string
  source: string
  link: { href: string; label: string }
}

function BidLineDetail({
  rowKey,
  rowValue,
  accountId,
  clientId,
  onOpenHotels,
  onChanged,
}: {
  rowKey: string
  rowValue: number
  accountId?: string
  clientId?: string
  onOpenHotels: () => void
  onChanged?: () => void
}) {
  const { getToken } = useAuth()
  const [constraints, setConstraints] = useState<Record<string, any> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!accountId || !clientId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const token = await getToken()
        const res = await fetch(
          `/api/accounts/${accountId}/clients/${clientId}/operational-constraints`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const j = await res.json()
        if (!cancelled) setConstraints(j)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [accountId, clientId, getToken])

  const saveField = async (body: Record<string, unknown>) => {
    if (!accountId || !clientId) return
    const token = await getToken()
    const res = await fetch(
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
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error((j as any).error ?? `HTTP ${res.status}`)
    }
    setConstraints(await res.json())
    onChanged?.()
  }

  if (loading) {
    return (
      <div className="px-4 pb-3 pt-1 text-xs text-fg-muted flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading…
      </div>
    )
  }
  if (error || !constraints) {
    return (
      <div className="px-4 pb-3 pt-1 text-xs text-danger">
        {error ?? 'Could not load cost assumptions'}
      </div>
    )
  }

  const rows = renderRowDetail(rowKey, constraints)
  return (
    <div className="bg-surface-subtle/40 border-t border-border px-4 py-3 space-y-2">
      {rows.formulaText && (
        <p className="text-[11px] text-fg-subtle italic">{rows.formulaText}</p>
      )}
      <div className="space-y-1.5">
        {rows.locked.map((l, i) => (
          <LockedFieldRow key={`l-${i}`} spec={l} />
        ))}
        {rows.editable.map((e, i) => (
          <InlineEditableRow
            key={`e-${i}`}
            spec={e}
            constraints={constraints}
            onSave={saveField}
          />
        ))}
      </div>
      {rows.actions.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {rows.actions.map((a, i) =>
            a.kind === 'open-hotels' ? (
              <Button
                key={`a-${i}`}
                size="sm"
                variant="secondary"
                onClick={onOpenHotels}
              >
                {a.label}
              </Button>
            ) : (
              <Button
                key={`a-${i}`}
                size="sm"
                variant="secondary"
                onClick={() => a.href && navigateToAnchor(a.href)}
              >
                {a.label}
              </Button>
            )
          )}
        </div>
      )}
      <p className="text-[10px] text-fg-subtle pt-1">
        Total: <span className="font-mono">${rowValue.toLocaleString()}</span>
        {' · '}Saved edits trigger a bid recalculation.
      </p>
    </div>
  )
}

function navigateToAnchor(href: string) {
  if (href.startsWith('#')) {
    const id = href.slice(1)
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
  }
  window.location.hash = href.replace(/^#/, '')
}

function LockedFieldRow({ spec }: { spec: LockedSpec }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="flex items-center gap-1.5 text-fg-muted">
        <Lock className="h-3 w-3 text-fg-subtle" />
        {spec.label}
        <span className="text-fg-subtle">— from {spec.source}</span>
      </span>
      <button
        type="button"
        onClick={() => navigateToAnchor(spec.link.href)}
        className="text-accent text-[11px] hover:underline"
      >
        {spec.link.label} →
      </button>
    </div>
  )
}

function InlineEditableRow({
  spec,
  constraints,
  onSave,
}: {
  spec: EditableSpec
  constraints: Record<string, any>
  onSave: (body: Record<string, unknown>) => Promise<void>
}) {
  // Read current value (raw storage form). For jsonb-nested fields,
  // walk the container.
  const rawCurrent = spec.jsonbContainer
    ? (constraints[spec.jsonbContainer] ?? {})[spec.jsonbKey ?? '']
    : constraints[spec.field]
  const rawDefault = spec.jsonbContainer
    ? (constraints.system_defaults?.[spec.jsonbContainer] ?? {})[spec.jsonbKey ?? '']
    : constraints.system_defaults?.[spec.field]

  // Convert raw storage → display value.
  const toDisplay = (v: number | null | undefined): string => {
    if (v == null) return ''
    if (spec.unit === 'percent-decimal') return String(Math.round(v * 1000) / 10) // 0.18 → 18
    return String(v)
  }
  const fromDisplay = (s: string): number | null => {
    if (s.trim() === '') return null
    const n = Number(s)
    if (!Number.isFinite(n)) return null
    if (spec.unit === 'percent-decimal') return n / 100
    return n
  }
  const formatDisplay = (v: number | null | undefined): string => {
    if (v == null) return '—'
    if (spec.unit === 'currency') return `$${Number(v).toFixed(2)}`
    if (spec.unit === 'currency-per-mile') return `$${Number(v).toFixed(3)}/mi`
    if (spec.unit === 'percent-decimal') return `${(Number(v) * 100).toFixed(1)}%`
    if (spec.unit === 'percent-whole') return `${Number(v).toFixed(1)}%`
    return String(v)
  }

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(toDisplay(rawCurrent))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const isOverridden =
    typeof rawCurrent === 'number' &&
    typeof rawDefault === 'number' &&
    Math.abs(rawCurrent - rawDefault) > 1e-9

  const submit = async (value: number | null) => {
    setSaving(true)
    setErr(null)
    try {
      const body: Record<string, unknown> = {}
      if (spec.jsonbContainer && spec.jsonbKey) {
        const merged = { ...(constraints[spec.jsonbContainer] ?? {}) }
        if (value == null) delete merged[spec.jsonbKey]
        else merged[spec.jsonbKey] = value
        body[spec.jsonbContainer] = merged
      } else {
        body[spec.field] = value
      }
      await onSave(body)
      setEditing(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-fg-muted">{spec.label}</span>
      {editing ? (
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            step={spec.step ?? 'any'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
            autoFocus
            className="w-24 h-7 text-xs font-mono"
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit(fromDisplay(draft))
              if (e.key === 'Escape') {
                setDraft(toDisplay(rawCurrent))
                setEditing(false)
              }
            }}
          />
          <Button
            size="sm"
            onClick={() => submit(fromDisplay(draft))}
            disabled={saving}
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(toDisplay(rawCurrent))
              setEditing(false)
              setErr(null)
            }}
            disabled={saving}
          >
            Cancel
          </Button>
          {err && <span className="text-danger text-[10px]">{err}</span>}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="font-mono text-fg tabular-nums">{formatDisplay(rawCurrent)}</span>
          {isOverridden && (
            <button
              type="button"
              onClick={() => submit(null)}
              className="text-fg-subtle hover:text-danger inline-flex items-center gap-0.5 text-[10px]"
              title={`Reset to default (${formatDisplay(rawDefault)})`}
              disabled={saving}
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setDraft(toDisplay(rawCurrent))
              setEditing(true)
            }}
            className="text-accent hover:text-accent-strong inline-flex items-center gap-0.5 text-[10px]"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>
        </div>
      )}
    </div>
  )
}

function renderRowDetail(
  rowKey: string,
  _constraints: Record<string, any>
): {
  formulaText: string | null
  locked: LockedSpec[]
  editable: EditableSpec[]
  actions: Array<{ kind: 'open-hotels' | 'navigate'; label: string; href?: string }>
} {
  const HOURS_LINK: LockedSpec['link'] = {
    href: '#cost-group-productivity-rules',
    label: 'Edit hours-per-visit defaults',
  }
  const CREW_LINK: LockedSpec['link'] = {
    href: '#cost-group-crew-economics',
    label: 'Edit crew economics',
  }
  const REVENUE_NOTE = 'cascades from service line pricing'
  switch (rowKey) {
    case 'direct_labor':
      return {
        formulaText: 'Hours × crew size × hourly loaded labor cost',
        locked: [
          { label: 'Total work hours', source: 'Cost Assumptions', link: HOURS_LINK },
          { label: 'Crew size', source: 'Crew Strategy', link: CREW_LINK },
        ],
        editable: [
          {
            field: 'hourly_loaded_labor_cost',
            label: 'Hourly loaded labor cost',
            unit: 'currency',
            step: '0.01',
          },
        ],
        actions: [],
      }
    case 'vehicle_fuel':
      return {
        formulaText: 'Drive miles × fuel cost per mile',
        locked: [
          {
            label: 'Drive miles',
            source: 'routing template',
            link: { href: '#module-crew_strategy', label: 'Open Crew Strategy' },
          },
        ],
        editable: [
          {
            field: 'fuel_cost_per_mile',
            label: 'Fuel cost per mile',
            unit: 'currency-per-mile',
            step: '0.001',
          },
        ],
        actions: [],
      }
    case 'vehicle_lease':
      return {
        formulaText: 'Per-crew vehicle config (lease, purchase, or personal reimbursement)',
        locked: [],
        editable: [],
        actions: [
          {
            kind: 'navigate',
            label: 'Edit per-crew vehicle config',
            href: '#cost-group-vehicle-fuel',
          },
        ],
      }
    case 'hotels':
      return {
        formulaText: 'Per-cluster overnight cost from the Phase 4.1 cluster breakdown',
        locked: [],
        editable: [],
        actions: [{ kind: 'open-hotels', label: 'View / edit cluster breakdown' }],
      }
    case 'supplies':
      return {
        formulaText: 'Direct labor × supplies % of labor',
        locked: [{ label: 'Direct labor', source: 'cascades from labor' } as any].map(
          (l) =>
            ({
              ...l,
              link: HOURS_LINK,
            }) as LockedSpec
        ),
        editable: [
          {
            field: 'supplies_pct_of_labor',
            label: 'Supplies (% of labor)',
            unit: 'percent-decimal',
            step: '0.1',
          },
        ],
        actions: [],
      }
    case 'branch_overhead':
      return {
        formulaText: 'Sum of per-branch overhead (main / satellite breakdown)',
        locked: [
          {
            label: 'Selected branches',
            source: 'Branch Decision',
            link: { href: '#module-branch_optimization', label: 'Edit branch selection' },
          },
        ],
        editable: [],
        actions: [
          {
            kind: 'navigate',
            label: 'Edit per-branch overhead config',
            href: '#cost-group-branch-operational-costs',
          },
        ],
      }
    case 'insurance':
      return {
        formulaText: 'Bid revenue × insurance % (subject to minimum premium)',
        locked: [
          { label: 'Bid revenue', source: REVENUE_NOTE, link: HOURS_LINK },
        ],
        editable: [
          {
            field: 'insurance_config',
            jsonbContainer: 'insurance_config',
            jsonbKey: 'percentage_of_revenue',
            label: 'Insurance (% of revenue)',
            unit: 'percent-whole',
            step: '0.1',
          },
          {
            field: 'insurance_config',
            jsonbContainer: 'insurance_config',
            jsonbKey: 'minimum_annual_premium',
            label: 'Minimum annual premium',
            unit: 'currency',
            step: '100',
          },
        ],
        actions: [],
      }
    case 'corporate_overhead':
      return {
        formulaText: 'Direct cost × corporate overhead %',
        locked: [
          {
            label: 'Direct cost',
            source: 'cascades',
            link: HOURS_LINK,
          },
        ],
        editable: [
          {
            field: 'corporate_overhead_pct',
            label: 'Corporate overhead (% of direct cost)',
            unit: 'percent-decimal',
            step: '0.1',
          },
        ],
        actions: [],
      }
    case 'margin':
      return {
        formulaText: 'cost × margin_pct ÷ (1 − margin_pct)',
        locked: [
          {
            label: 'Total cost (pre-margin)',
            source: 'cascades',
            link: HOURS_LINK,
          },
        ],
        editable: [
          {
            field: 'target_gross_margin_pct',
            label: 'Target gross margin (account default)',
            unit: 'percent-decimal',
            step: '0.5',
          },
        ],
        actions: [
          {
            kind: 'navigate',
            label: 'Edit per-line margins (Service Line Pricing)',
            href: '#cost-group-service-line-pricing',
          },
        ],
      }
    default:
      return { formulaText: null, locked: [], editable: [], actions: [] }
  }
}
