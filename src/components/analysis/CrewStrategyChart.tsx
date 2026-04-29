import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend } from 'recharts'

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

interface CrewStrategyOutputs {
  property_count: number
  k_used: number
  total_project_hours_per_year: number
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

const STATUS_BADGE: Record<UtilStatus, string> = {
  ideal: 'bg-green-100 text-green-700 border-green-200',
  acceptable: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  underutilized: 'bg-red-100 text-red-700 border-red-200',
  overcapacity: 'bg-red-100 text-red-700 border-red-200',
}
const STATUS_LABEL: Record<UtilStatus, string> = {
  ideal: '🟢 Ideal',
  acceptable: '🟡 Acceptable',
  underutilized: '🔴 Underutilized',
  overcapacity: '🔴 Overcapacity',
}

function formatPop(p: number | null | undefined): string {
  if (p == null) return '—'
  if (p >= 1_000_000) return `${(p / 1_000_000).toFixed(1)}M`
  if (p >= 1000) return `${(p / 1000).toFixed(0)}K`
  return p.toString()
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

      {/* Utilization breakdown for Option B (driven by user-selected scope) */}
      {data.options.B.utilization_breakdown && (
        <UtilizationSection
          option={data.options.B}
          scope={data.utilization_constraint?.scope ?? 'per_branch'}
        />
      )}

      {/* Constraint violations */}
      {data.constraint_violations && data.constraint_violations.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">⚠ Constraint violations</h4>
          <ul className="space-y-2">
            {data.constraint_violations.map((v, i) => (
              <li
                key={i}
                className={`border-l-4 px-3 py-2 text-sm rounded-r ${
                  v.severity === 'flag'
                    ? 'border-red-400 bg-red-50'
                    : 'border-orange-400 bg-orange-50'
                }`}
              >
                <div className="font-medium text-gray-900">
                  {v.scope === 'branch' ? '' : `${v.scope.toUpperCase()} `}
                  {v.name}
                </div>
                <div className="text-xs text-gray-700">
                  {v.metric === 'utilization_pct' ? `${v.actual}% utilization` : v.actual} —{' '}
                  {v.threshold_violated.replace('_', ' ')}
                </div>
                <div className="text-xs text-gray-600 mt-0.5 italic">{v.suggestion}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
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
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">
          Portfolio utilization (Option B)
        </h4>
        <div className="border rounded-lg p-3 flex items-center justify-between gap-4">
          <div>
            <div className="text-2xl font-bold text-gray-900">
              {ub.portfolio.utilization_pct}%
            </div>
            <div className="text-xs text-gray-500">
              {ub.portfolio.work_hours.toLocaleString()} work hrs ÷{' '}
              {ub.portfolio.available_hours.toLocaleString()} available · {ub.portfolio.crew_count} crews
            </div>
          </div>
          <span
            className={`text-xs px-2.5 py-1 rounded border font-medium ${STATUS_BADGE[ub.portfolio.status]}`}
          >
            {STATUS_LABEL[ub.portfolio.status]}
          </span>
        </div>
      </div>
    )
  }

  if (scope === 'per_region' && ub.per_region && ub.per_region.length > 0) {
    return (
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">
          Per-region utilization (Option B)
        </h4>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-2 pr-4">Region</th>
              <th className="py-2 pr-4">Branches</th>
              <th className="py-2 pr-4 text-right">Work hrs</th>
              <th className="py-2 pr-4 text-right">Available</th>
              <th className="py-2 pr-4 text-right">Util</th>
              <th className="py-2 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {ub.per_region.map((r) => (
              <tr key={r.region} className="border-b last:border-0">
                <td className="py-2 pr-4 font-medium text-gray-900">{r.region}</td>
                <td className="py-2 pr-4 text-xs text-gray-600">
                  {r.branches_in_region.join(', ')}
                </td>
                <td className="py-2 pr-4 text-right">{r.work_hours.toLocaleString()}</td>
                <td className="py-2 pr-4 text-right">{r.available_hours.toLocaleString()}</td>
                <td className="py-2 pr-4 text-right">{r.aggregate_utilization_pct}%</td>
                <td className="py-2 text-right">
                  <span
                    className={`text-xs px-2 py-0.5 rounded border ${STATUS_BADGE[r.status]}`}
                  >
                    {STATUS_LABEL[r.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  // per_branch (default)
  if (!ub.per_branch || ub.per_branch.length === 0) return null
  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-700 mb-2">
        Per-branch utilization (Option B)
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-2 pr-3">Branch</th>
              <th className="py-2 pr-3 text-right">Pop</th>
              <th className="py-2 pr-3 text-right">Crews</th>
              <th className="py-2 pr-3 text-right">Work hrs</th>
              <th className="py-2 pr-3 text-right">Available</th>
              <th className="py-2 pr-3 text-right">Util</th>
              <th className="py-2 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {ub.per_branch.map((b) => (
              <tr key={b.branch_name} className="border-b last:border-0 align-top">
                <td className="py-2 pr-3 font-medium text-gray-900">
                  {b.city_state ?? b.branch_name}
                  {b.branch_name && b.city_state && b.branch_name !== b.city_state && (
                    <div className="text-xs text-gray-400 font-normal italic">
                      {b.branch_name}
                    </div>
                  )}
                </td>
                <td className="py-2 pr-3 text-right text-gray-600">{formatPop(b.population)}</td>
                <td className="py-2 pr-3 text-right">{b.crew_count}</td>
                <td className="py-2 pr-3 text-right">{b.work_hours.toLocaleString()}</td>
                <td className="py-2 pr-3 text-right text-gray-500">
                  {b.available_hours.toLocaleString()}
                </td>
                <td className="py-2 pr-3 text-right font-semibold">{b.utilization_pct}%</td>
                <td className="py-2 text-right">
                  <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_BADGE[b.status]}`}>
                    {STATUS_LABEL[b.status]}
                  </span>
                  {b.warning && (
                    <div className="text-xs text-gray-500 mt-1 italic max-w-xs">{b.warning}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
