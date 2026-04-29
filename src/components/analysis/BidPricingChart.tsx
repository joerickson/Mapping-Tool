import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

interface BidOutputs {
  property_count: number
  total_sqft: number
  sourced_from: {
    crew_strategy_option: string | null
    crew_count: number | null
    branch_count: number | null
    fte_count: number | null
  }
  cost_buildup: {
    direct_labor: number
    vehicle_fuel: number
    vehicle_lease: number
    hotels: number
    supplies: number
    branch_overhead: number
    insurance: number
    total_direct_cost: number
  }
  indirect_cost: { corporate_overhead: number }
  total_cost: number
  margin: { target_pct: number; margin_amount: number }
  bid_total: number
  bid_per_property: number
  bid_per_sqft: number
  monthly_invoice_estimate: number
  cost_breakdown_pct: {
    labor: number
    vehicle: number
    overhead: number
    margin: number
    other: number
  }
}

const BUILDUP_COLOR: Record<string, string> = {
  direct_labor: '#3b82f6',
  vehicle_fuel: '#0891b2',
  vehicle_lease: '#0284c7',
  hotels: '#14b8a6',
  supplies: '#84cc16',
  branch_overhead: '#a855f7',
  insurance: '#d946ef',
  corporate_overhead: '#ec4899',
  margin: '#16a34a',
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

export default function BidPricingChart({ data }: { data: BidOutputs }) {
  const buildupRows = [
    { key: 'direct_labor', value: data.cost_buildup.direct_labor },
    { key: 'vehicle_fuel', value: data.cost_buildup.vehicle_fuel },
    { key: 'vehicle_lease', value: data.cost_buildup.vehicle_lease },
    { key: 'hotels', value: data.cost_buildup.hotels },
    { key: 'supplies', value: data.cost_buildup.supplies },
    { key: 'branch_overhead', value: data.cost_buildup.branch_overhead },
    { key: 'insurance', value: data.cost_buildup.insurance },
    { key: 'corporate_overhead', value: data.indirect_cost.corporate_overhead },
    { key: 'margin', value: data.margin.margin_amount },
  ].filter((r) => r.value > 0)

  return (
    <div className="space-y-5">
      {/* Headline bid number */}
      <div className="bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 border-2 border-green-200 rounded-xl p-5">
        <div className="text-xs font-semibold text-green-800 uppercase tracking-wide">
          Recommended bid
        </div>
        <div className="text-4xl font-bold text-gray-900 mt-1">
          ${(data.bid_total / 1_000_000).toFixed(2)}M
          <span className="text-base font-medium text-gray-500 ml-1">/year</span>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3 text-sm">
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Per property</div>
            <div className="font-semibold text-gray-900">
              ${data.bid_per_property.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Per sqft</div>
            <div className="font-semibold text-gray-900">
              ${data.bid_per_sqft.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Monthly invoice</div>
            <div className="font-semibold text-gray-900">
              ${data.monthly_invoice_estimate.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Cost buildup bars */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">Cost buildup</h4>
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <BarChart data={buildupRows.map((r) => ({ ...r, name: ROW_LABELS[r.key] }))} layout="vertical" margin={{ left: 100 }}>
              <XAxis
                type="number"
                tick={{ fontSize: 11 }}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
              />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
              <Tooltip
                formatter={(v: number) => [`$${v.toLocaleString()}`, 'Amount']}
                contentStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="value">
                {buildupRows.map((r, i) => (
                  <Cell key={i} fill={BUILDUP_COLOR[r.key] ?? '#6b7280'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Breakdown table */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">Detailed breakdown</h4>
        <table className="w-full text-sm">
          <tbody>
            {buildupRows.map((r) => (
              <tr key={r.key} className="border-b last:border-0">
                <td className="py-1.5 pr-4 text-gray-700">{ROW_LABELS[r.key]}</td>
                <td className="py-1.5 text-right font-mono text-gray-900">
                  ${r.value.toLocaleString()}
                </td>
              </tr>
            ))}
            <tr className="border-t-2">
              <td className="py-2 pr-4 font-semibold text-gray-900">Total bid</td>
              <td className="py-2 text-right font-mono font-bold text-gray-900">
                ${data.bid_total.toLocaleString()}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Composition pct */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">Bid composition</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <CompCard label="Labor" pct={data.cost_breakdown_pct.labor} color="#3b82f6" />
          <CompCard label="Vehicle/fuel" pct={data.cost_breakdown_pct.vehicle} color="#0891b2" />
          <CompCard label="Overhead" pct={data.cost_breakdown_pct.overhead} color="#a855f7" />
          <CompCard label="Margin" pct={data.cost_breakdown_pct.margin} color="#16a34a" />
        </div>
      </div>

      {data.sourced_from.crew_strategy_option && (
        <div className="text-xs text-gray-500 italic border-t pt-2">
          Labor sourced from Crew Strategy Option {data.sourced_from.crew_strategy_option} ·{' '}
          {data.sourced_from.crew_count} crews ·{' '}
          {data.sourced_from.branch_count} branches
        </div>
      )}
    </div>
  )
}

function CompCard({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="border rounded-lg p-2.5">
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="font-semibold text-gray-900 mt-0.5">{pct}%</div>
      <div className="h-1.5 mt-1 rounded bg-gray-100 overflow-hidden">
        <div className="h-full" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
      </div>
    </div>
  )
}
