import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

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

const BUCKET_COLORS: Record<string, string> = {
  under_30_min: '#16a34a',
  '30_to_60_min': '#65a30d',
  '60_to_90_min': '#ca8a04',
  '90_to_120_min': '#ea580c',
  over_120_min: '#dc2626',
}

const EFFICIENCY_BADGE: Record<'high' | 'medium' | 'low', string> = {
  high: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-red-100 text-red-700',
}

export default function DriveTimeChart({ data }: { data: DriveTimeOutputs }) {
  const histogramData = Object.entries(data.drive_distribution).map(([key, count]) => ({
    key,
    label: BUCKET_LABELS[key] ?? key,
    count,
  }))

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">Drive time distribution</h4>
        <div className="h-48 w-full">
          <ResponsiveContainer>
            <BarChart data={histogramData}>
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(v: number) => [`${v} properties`, 'Count']}
                contentStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="count">
                {histogramData.map((d, i) => (
                  <Cell key={i} fill={BUCKET_COLORS[d.key] ?? '#6b7280'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">Cluster efficiency</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2 pr-4">Branch</th>
                <th className="py-2 pr-4 text-right">Properties</th>
                <th className="py-2 pr-4 text-right">Avg drive (min)</th>
                <th className="py-2 pr-4 text-right">Within 60 min</th>
                <th className="py-2">Efficiency</th>
              </tr>
            </thead>
            <tbody>
              {data.cluster_efficiency.map((c) => (
                <tr key={c.branch} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-medium text-gray-900">
                    {c.city_state ?? c.branch}
                  </td>
                  <td className="py-2 pr-4 text-right">{c.property_count}</td>
                  <td className="py-2 pr-4 text-right">{c.avg_drive_minutes}</td>
                  <td className="py-2 pr-4 text-right">{c.properties_within_60min_pct}%</td>
                  <td className="py-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${EFFICIENCY_BADGE[c.efficiency_score]}`}>
                      {c.efficiency_score}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data.long_drive_properties.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">
            Long-drive properties ({data.long_drive_properties.length})
          </h4>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {data.long_drive_properties.map((p) => (
              <div key={p.property_id} className="border-l-4 border-red-400 bg-red-50 px-3 py-2 text-sm">
                <div className="font-medium text-gray-900">{p.address}</div>
                <div className="text-xs text-gray-600">{p.drive_minutes}-min one-way drive</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
