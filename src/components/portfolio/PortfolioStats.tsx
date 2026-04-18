import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { PropertyWithLocations } from '../../types'
import { CATEGORY_COLORS } from '../../lib/constants'

interface PortfolioStatsProps {
  properties: PropertyWithLocations[]
}

export default function PortfolioStats({ properties }: PortfolioStatsProps) {
  const totalSqft = properties.reduce((sum, p) => {
    return sum + p.service_locations.reduce((s, l) => s + (l.serviceable_sqft ?? 0), 0)
  }, 0)

  const locationCount = properties.reduce((sum, p) => sum + p.service_locations.length, 0)

  // Category breakdown for pie chart
  const categoryMap = new Map<string, number>()
  properties.forEach((p) => {
    const cat = p.rbm_category ?? 'unknown'
    categoryMap.set(cat, (categoryMap.get(cat) ?? 0) + 1)
  })

  const pieData = Array.from(categoryMap.entries()).map(([name, value]) => ({
    name,
    value,
    color: CATEGORY_COLORS[name] ?? CATEGORY_COLORS.default,
  }))

  return (
    <div className="grid grid-cols-3 gap-4">
      <StatCard label="Properties" value={properties.length.toLocaleString()} />
      <StatCard label="Service Locations" value={locationCount.toLocaleString()} />
      <StatCard label="Total Serviceable Sqft" value={totalSqft.toLocaleString()} />

      {pieData.length > 0 && (
        <div className="col-span-3 bg-white rounded-xl border p-4">
          <p className="text-sm font-semibold text-gray-700 mb-3">Category Mix</p>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              >
                {pieData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
    </div>
  )
}
