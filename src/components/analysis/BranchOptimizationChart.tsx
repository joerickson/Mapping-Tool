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
} from 'recharts'

interface KResult {
  k: number
  branches: Array<{
    lat: number
    lng: number
    city_state: string
    property_count: number
    total_sqft: number
    locked?: boolean
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
}

interface SelectionTableProps {
  // Render the per-K selection table that lets the user pick which K to
  // build a manual selection for. Optional — when omitted, the chart skips
  // the table (e.g. when a selection is already locked in).
  onBuild?: (k: number) => void
  showTable?: boolean
}

export default function BranchOptimizationChart({
  data,
  onBuild,
  showTable,
}: { data: BranchOptOutputs } & SelectionTableProps) {
  const recommended = data.k_results.find((r) => r.k === data.recommended_k)

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">
          Annual cost by branch count (k) · recommended k = {data.recommended_k}
        </h4>
        <div className="h-64 w-full">
          <ResponsiveContainer>
            <ComposedChart data={data.k_results}>
              <XAxis dataKey="k" tick={{ fontSize: 11 }} label={{ value: 'k (# branches)', position: 'insideBottom', offset: -2, fontSize: 11 }} />
              <YAxis
                yAxisId="cost"
                tick={{ fontSize: 11 }}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
              />
              <YAxis
                yAxisId="drive"
                orientation="right"
                tick={{ fontSize: 11 }}
                tickFormatter={(v: number) => `${v}mi`}
              />
              <Tooltip
                formatter={(value: number, name: string) => {
                  if (name === 'avg_drive_per_property') return [`${value.toFixed(1)} mi`, 'Avg drive/property']
                  return [`$${value.toLocaleString()}`, name]
                }}
                contentStyle={{ fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine x={data.recommended_k} stroke="#16a34a" strokeDasharray="3 3" yAxisId="cost" />
              {data.floor_k && data.floor_k > 0 && (
                <ReferenceLine
                  x={data.floor_k}
                  stroke="#dc2626"
                  strokeDasharray="2 4"
                  yAxisId="cost"
                  label={{ value: 'Floor (locked)', fontSize: 10, fill: '#dc2626' }}
                />
              )}
              <Bar yAxisId="cost" dataKey="drive_cost" stackId="a" fill="#3b82f6" name="Drive cost" />
              <Bar yAxisId="cost" dataKey="branch_cost" stackId="a" fill="#a855f7" name="Branch cost">
                {data.k_results.map((r, i) => (
                  <Cell key={i} fill={r.is_elbow ? '#16a34a' : '#a855f7'} />
                ))}
              </Bar>
              <Line
                yAxisId="drive"
                type="monotone"
                dataKey="avg_drive_per_property"
                stroke="#f97316"
                strokeWidth={2}
                dot={{ r: 3 }}
                name="Avg drive/property (mi)"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {recommended && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">
            Recommended branches (k = {recommended.k})
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-4">Location</th>
                  <th className="py-2 pr-4 text-right">Properties</th>
                  <th className="py-2 pr-4 text-right">Total sqft</th>
                  <th className="py-2 pr-4 text-right">Avg drive (mi)</th>
                  <th className="py-2 text-right">Max drive (mi)</th>
                </tr>
              </thead>
              <tbody>
                {recommended.branches
                  .slice()
                  .sort((a, b) => b.property_count - a.property_count)
                  .map((b, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium text-gray-900">
                        {b.city_state}
                        {b.locked && (
                          <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 align-middle">
                            locked
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right">{b.property_count}</td>
                      <td className="py-2 pr-4 text-right">{b.total_sqft.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right">{b.avg_drive_distance_miles}</td>
                      <td className="py-2 text-right">{b.max_drive_distance_miles}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per-K selection table — drives the Branch Selection workflow */}
      {showTable && onBuild && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-1">
            Pick a branch count to build your selection
          </h4>
          <p className="text-xs text-gray-500 mb-2">
            Each row shows the modeled cost at K branches. Click a row's button to start
            building your selection — you'll specify the actual locations manually.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-3">K</th>
                  <th className="py-2 pr-3 text-right">Total $/yr</th>
                  <th className="py-2 pr-3 text-right">Drive</th>
                  <th className="py-2 pr-3 text-right">Branch</th>
                  <th className="py-2 pr-3 text-right">Avg drive (mi)</th>
                  <th className="py-2 pr-3">Optimization-suggested centroids</th>
                  <th className="py-2 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {data.k_results.map((r) => {
                  const isRec = r.k === data.recommended_k
                  return (
                    <tr
                      key={r.k}
                      className={`border-b last:border-0 ${
                        isRec ? 'bg-green-50' : ''
                      }`}
                    >
                      <td className="py-2 pr-3 font-mono font-semibold text-gray-900">
                        {r.k}
                        {isRec && (
                          <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700 align-middle">
                            Recommended
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        ${r.total_annual_cost.toLocaleString()}
                      </td>
                      <td className="py-2 pr-3 text-right text-gray-500">
                        ${r.drive_cost.toLocaleString()}
                      </td>
                      <td className="py-2 pr-3 text-right text-gray-500">
                        ${r.branch_cost.toLocaleString()}
                      </td>
                      <td className="py-2 pr-3 text-right text-gray-500">
                        {r.avg_drive_per_property}
                      </td>
                      <td className="py-2 pr-3 text-xs text-gray-600">
                        {r.branches.map((b) => b.city_state).join(' · ')}
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onBuild(r.k)}
                          className="px-2.5 py-1 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700"
                        >
                          Build my K={r.k} selection →
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
