import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend } from 'recharts'

interface CrewOption {
  label: string
  crew_count: number
  surge_crew_count?: number
  surge_weeks?: number
  utilization_pct: number
  annual_labor_cost: number
  annual_vehicle_cost: number
  total_annual_cost: number
  pros: string[]
  cons: string[]
  recommended_use_case: string
  branch_breakdown?: Array<{
    branch: string
    crew_count: number
    work_hours: number
    utilization_pct: number
    property_count: number
  }>
}

interface CrewStrategyOutputs {
  property_count: number
  k_used: number
  total_project_hours_per_year: number
  options: { A: CrewOption; B: CrewOption; C: CrewOption }
  recommended_option: 'A' | 'B' | 'C'
  recommended_rationale: string
}

const RECOMMENDED_BG: Record<string, string> = {
  A: 'border-blue-500 ring-1 ring-blue-200',
  B: 'border-green-500 ring-1 ring-green-200',
  C: 'border-purple-500 ring-1 ring-purple-200',
}

export default function CrewStrategyChart({ data }: { data: CrewStrategyOutputs }) {
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
    <div className="space-y-5">
      {/* Recommendation banner */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg px-4 py-3">
        <div className="text-sm text-gray-500 font-semibold uppercase tracking-wide">
          Recommended
        </div>
        <div className="text-lg font-bold text-gray-900 mt-0.5">
          Option {data.recommended_option}: {data.options[data.recommended_option].label}
        </div>
        <div className="text-sm text-gray-700 mt-1">{data.recommended_rationale}</div>
      </div>

      {/* Cost comparison bar chart */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">Annual cost comparison</h4>
        <div className="h-56 w-full">
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                formatter={(v: number, name: string) => [`$${v.toLocaleString()}`, name]}
                contentStyle={{ fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="labor" stackId="a" fill="#3b82f6" name="Labor" />
              <Bar dataKey="vehicle" stackId="a" fill="#a855f7" name="Vehicle/fuel">
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.isRecommended ? '#16a34a' : '#a855f7'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 3-card option comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {opts.map((o) => (
          <div
            key={o.key}
            className={`bg-white rounded-lg border-2 p-4 ${
              o.key === data.recommended_option
                ? RECOMMENDED_BG[o.key]
                : 'border-gray-200'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Option {o.key}
                </div>
                <div className="font-semibold text-gray-900">{o.label}</div>
              </div>
              {o.key === data.recommended_option && (
                <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">
                  Recommended
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm border-t border-b py-2 my-2">
              <div>
                <div className="text-xs text-gray-500">Crews</div>
                <div className="font-semibold">
                  {o.crew_count}
                  {o.surge_crew_count ? ` + ${o.surge_crew_count} surge` : ''}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Utilization</div>
                <div className="font-semibold">{o.utilization_pct}%</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Labor</div>
                <div className="font-semibold">
                  ${(o.annual_labor_cost / 1000).toFixed(0)}k
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Total</div>
                <div className="font-semibold">
                  ${(o.total_annual_cost / 1000).toFixed(0)}k
                </div>
              </div>
            </div>

            <div className="mt-2">
              <div className="text-xs font-semibold text-gray-500 mb-1">Pros</div>
              <ul className="text-xs space-y-0.5 text-gray-700 list-disc pl-4">
                {o.pros.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
            <div className="mt-2">
              <div className="text-xs font-semibold text-gray-500 mb-1">Cons</div>
              <ul className="text-xs space-y-0.5 text-gray-700 list-disc pl-4">
                {o.cons.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
            <div className="mt-2 pt-2 border-t text-xs italic text-gray-500">
              Best for: {o.recommended_use_case}
            </div>
          </div>
        ))}
      </div>

      {/* Branch-level breakdown for Option B */}
      {data.options.B.branch_breakdown && data.options.B.branch_breakdown.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">
            Per-branch staffing (Option B)
          </h4>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2 pr-4">Branch</th>
                <th className="py-2 pr-4 text-right">Crews</th>
                <th className="py-2 pr-4 text-right">Properties</th>
                <th className="py-2 pr-4 text-right">Annual hours</th>
                <th className="py-2 text-right">Utilization</th>
              </tr>
            </thead>
            <tbody>
              {data.options.B.branch_breakdown.map((b) => (
                <tr key={b.branch} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-medium text-gray-900">{b.branch}</td>
                  <td className="py-2 pr-4 text-right">{b.crew_count}</td>
                  <td className="py-2 pr-4 text-right">{b.property_count}</td>
                  <td className="py-2 pr-4 text-right">{b.work_hours.toLocaleString()}</td>
                  <td className="py-2 text-right">{b.utilization_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
