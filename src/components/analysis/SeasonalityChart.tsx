import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts'

interface WindowResult {
  window_name: string
  start_date: string
  end_date: string
  duration_days: number
  demand: {
    service_location_count: number
    total_hours_required: number
    crew_days_required: number
    simultaneous_crews_needed: number
  }
  baseline_capacity: {
    crew_count: number
    crew_days_available: number
  }
  surge_required: boolean
  surge_crews_needed: number
  notes: string
}

interface SeasonalityOutputs {
  property_count: number
  windows: WindowResult[]
  year_round_baseline: {
    service_location_count: number
    property_count: number
    avg_weekly_hours: number
    crews_required: number
  }
  peak_to_baseline_ratio: number
  baseline_crew_count_used: number
}

const WINDOW_LABEL: Record<string, string> = {
  summer_break: 'Summer Break',
  winter_break: 'Winter Break',
  spring_break: 'Spring Break',
}

export default function SeasonalityChart({ data }: { data: SeasonalityOutputs }) {
  const chartData = data.windows.map((w) => ({
    name: WINDOW_LABEL[w.window_name] ?? w.window_name,
    crews_needed: w.demand.simultaneous_crews_needed,
    surge_crews: w.surge_crews_needed,
    baseline: w.baseline_capacity.crew_count,
  }))

  const baseline = data.baseline_crew_count_used

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Baseline</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">
            {baseline}
            <span className="text-sm font-medium text-gray-500 ml-1">crews</span>
          </div>
          <div className="text-xs text-gray-600 mt-1">
            {data.year_round_baseline.crews_required.toFixed(1)} crews avg-week demand
          </div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <div className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Peak ratio</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">
            {data.peak_to_baseline_ratio}x
          </div>
          <div className="text-xs text-gray-600 mt-1">peak-week vs avg-week demand</div>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Year-round</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">
            {data.year_round_baseline.service_location_count}
            <span className="text-sm font-medium text-gray-500 ml-1">SLs</span>
          </div>
          <div className="text-xs text-gray-600 mt-1">
            {data.year_round_baseline.avg_weekly_hours.toLocaleString()} hrs/week
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">
          Simultaneous crews required by window (vs baseline of {baseline})
        </h4>
        <div className="h-48 w-full">
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={baseline} stroke="#16a34a" strokeDasharray="3 3" label={{ value: 'Baseline', fontSize: 11, fill: '#16a34a' }} />
              <Bar dataKey="crews_needed" fill="#3b82f6" name="Crews needed" />
              <Bar dataKey="surge_crews" fill="#f97316" name="Surge crews" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="space-y-2">
        {data.windows.map((w) => (
          <div
            key={w.window_name}
            className={`border-l-4 px-4 py-2 rounded-r ${
              w.surge_required ? 'border-orange-400 bg-orange-50' : 'border-gray-300 bg-gray-50'
            }`}
          >
            <div className="flex items-baseline justify-between">
              <div className="font-semibold text-gray-900">
                {WINDOW_LABEL[w.window_name] ?? w.window_name}
                <span className="text-xs text-gray-500 font-normal ml-2">
                  {w.start_date} – {w.end_date} · {w.duration_days} days
                </span>
              </div>
              {w.surge_required && (
                <span className="text-xs px-2 py-0.5 rounded bg-orange-100 text-orange-700">
                  Surge required: +{w.surge_crews_needed} crews
                </span>
              )}
            </div>
            <div className="text-sm text-gray-700 mt-0.5">
              {w.demand.service_location_count} SLs · {w.demand.total_hours_required.toLocaleString()} hrs ·{' '}
              {w.demand.simultaneous_crews_needed} simultaneous crews
            </div>
            <div className="text-xs text-gray-600 mt-1">{w.notes}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
