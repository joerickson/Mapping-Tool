import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

interface WorkforceOutputs {
  property_count: number
  workforce_a: {
    label: string
    description: string
    fte_equivalent?: number
    note: string
  }
  workforce_b: {
    label: string
    total_annual_hours: number
    fte_count: number
    part_time_position_count_estimate: number
    properties_served: number
    service_location_count: number
    by_offering: Array<{
      offering_name: string
      location_count: number
      total_hours: number
      fte_equivalent: number
    }>
  }
  total_workforce_size: {
    fte_equivalent: number
    distinct_positions_estimate: number
  }
}

export default function WorkforceSizingChart({ data }: { data: WorkforceOutputs }) {
  const a = data.workforce_a
  const b = data.workforce_b
  const t = data.total_workforce_size

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Workforce A</div>
          <div className="font-semibold text-gray-900 mt-0.5">{a.label}</div>
          <div className="mt-2 text-2xl font-bold text-gray-900">
            {a.fte_equivalent?.toFixed(0) ?? '—'}
            <span className="text-sm font-medium text-gray-500 ml-1">FTE</span>
          </div>
          <div className="text-xs text-gray-600 mt-2">{a.note}</div>
        </div>

        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
          <div className="text-xs font-semibold text-purple-700 uppercase tracking-wide">Workforce B</div>
          <div className="font-semibold text-gray-900 mt-0.5">{b.label}</div>
          <div className="mt-2 text-2xl font-bold text-gray-900">
            {b.fte_count.toFixed(1)}
            <span className="text-sm font-medium text-gray-500 ml-1">FTE</span>
          </div>
          <div className="text-xs text-gray-600 mt-1">
            {b.total_annual_hours.toLocaleString()} hrs/year · {b.properties_served} properties
          </div>
          <div className="text-xs text-gray-600 mt-1">
            ~{b.part_time_position_count_estimate} part-time positions
          </div>
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Total</div>
          <div className="font-semibold text-gray-900 mt-0.5">Combined workforce</div>
          <div className="mt-2 text-2xl font-bold text-gray-900">
            {t.fte_equivalent.toFixed(1)}
            <span className="text-sm font-medium text-gray-500 ml-1">FTE</span>
          </div>
          <div className="text-xs text-gray-600 mt-1">
            ~{t.distinct_positions_estimate} distinct positions (incl. part-time)
          </div>
        </div>
      </div>

      {b.by_offering.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">
            Workforce B by service offering
          </h4>
          <div className="h-44 w-full">
            <ResponsiveContainer>
              <BarChart data={b.by_offering} layout="vertical" margin={{ left: 80 }}>
                <XAxis
                  type="number"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: number) => v.toLocaleString()}
                />
                <YAxis
                  type="category"
                  dataKey="offering_name"
                  tick={{ fontSize: 11 }}
                  width={120}
                />
                <Tooltip
                  formatter={(v: number) => [`${v.toLocaleString()} hrs`, 'Annual hours']}
                  contentStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="total_hours" fill="#a855f7" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="w-full text-sm mt-2">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2 pr-4">Offering</th>
                <th className="py-2 pr-4 text-right">Locations</th>
                <th className="py-2 pr-4 text-right">Annual hrs</th>
                <th className="py-2 text-right">FTE</th>
              </tr>
            </thead>
            <tbody>
              {b.by_offering.map((o, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-medium text-gray-900">{o.offering_name}</td>
                  <td className="py-2 pr-4 text-right">{o.location_count}</td>
                  <td className="py-2 pr-4 text-right">{o.total_hours.toLocaleString()}</td>
                  <td className="py-2 text-right">{o.fte_equivalent.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
