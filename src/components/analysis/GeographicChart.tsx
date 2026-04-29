import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

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

const COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#d97706', '#dc2626', '#9333ea', '#0284c7']

export default function GeographicChart({ data }: { data: GeographicOutputs }) {
  const stateData = data.states.slice(0, 12) // top N states

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">Properties by state (top 12)</h4>
        <div className="h-56 w-full">
          <ResponsiveContainer>
            <BarChart data={stateData}>
              <XAxis dataKey="state" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(v: number) => [`${v} properties`, 'Count']}
                contentStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="property_count">
                {stateData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">Regions</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {data.regions.map((r) => (
            <div key={r.region_name} className="border rounded-lg px-3 py-2 text-sm">
              <div className="font-medium text-gray-900">{r.region_name}</div>
              <div className="text-xs text-gray-500">
                {r.property_count} properties · {r.states.join(', ')}
              </div>
            </div>
          ))}
        </div>
      </div>

      {data.outliers.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">
            Outliers ({data.outliers.length})
          </h4>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {data.outliers.map((o) => (
              <div
                key={o.property_id}
                className="border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-sm"
              >
                <div className="font-medium text-gray-900">
                  {o.address}, {o.city}, {o.state}
                </div>
                <div className="text-xs text-gray-600">{o.note}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
