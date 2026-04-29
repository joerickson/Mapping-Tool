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
}

export default function BranchOptimizationChart({ data }: { data: BranchOptOutputs }) {
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
                      <td className="py-2 pr-4 font-medium text-gray-900">{b.city_state}</td>
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
    </div>
  )
}
