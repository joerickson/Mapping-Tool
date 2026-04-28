import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../hooks/useAuth'
import { formatDistanceToNow } from 'date-fns'

interface FallbackSummary {
  county_fips: string
  county_name: string | null
  state: string | null
  total_calls: number
  total_cost_usd: number
  first_fallback: string
  last_fallback: string
}

export default function FallbacksPage() {
  const { getToken } = useAuth()
  const navigate = useNavigate()
  const [summaries, setSummaries] = useState<FallbackSummary[]>([])
  const [threshold, setThreshold] = useState(50)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const token = await getToken()
        const res = await fetch('/api/v1/admin/parcels/fallbacks', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('Failed to load fallback data')
        const { summaries, threshold } = await res.json()
        setSummaries(summaries)
        setThreshold(threshold)
      } catch (err) {
        setError(String(err))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  function rowClass(calls: number): string {
    if (calls >= 200) return 'bg-red-50 hover:bg-red-100'
    if (calls >= threshold) return 'bg-amber-50 hover:bg-amber-100'
    return 'hover:bg-gray-50'
  }

  function badge(calls: number): ReactNode {
    if (calls >= 200) {
      return (
        <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
          Strongly recommend purchasing
        </span>
      )
    }
    if (calls >= threshold) {
      return (
        <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
          Recommend purchasing
        </span>
      )
    }
    return null
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-gray-100 rounded" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">API Fallback Monitor</h1>
        <Link
          to="/admin/parcels/counties"
          className="text-sm text-blue-600 hover:underline"
        >
          County library →
        </Link>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        API calls made because county data hasn't been purchased — last 90 days.
        Alert threshold: <strong>{threshold} calls</strong> per county.
      </p>

      {error && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {summaries.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p>No API fallback calls recorded in the last 90 days.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {[
                  'County',
                  'State',
                  'Calls (90d)',
                  'API Cost',
                  'First Call',
                  'Last Call',
                  '',
                ].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {summaries.map((row) => (
                <tr key={row.county_fips} className={rowClass(row.total_calls)}>
                  <td className="px-4 py-3">
                    {row.county_name ?? row.county_fips}
                    {badge(row.total_calls)}
                  </td>
                  <td className="px-4 py-3">{row.state ?? '—'}</td>
                  <td className="px-4 py-3 font-medium">{row.total_calls.toLocaleString()}</td>
                  <td className="px-4 py-3">${row.total_cost_usd.toFixed(2)}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {formatDistanceToNow(new Date(row.first_fallback), { addSuffix: true })}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {formatDistanceToNow(new Date(row.last_fallback), { addSuffix: true })}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() =>
                        navigate(
                          `/admin/parcels/import?county_fips=${row.county_fips}&state=${row.state ?? ''}&county_name=${encodeURIComponent(row.county_name ?? '')}`
                        )
                      }
                      className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                    >
                      Mark as purchased →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
