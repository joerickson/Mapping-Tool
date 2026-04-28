import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { formatDistanceToNow, differenceInMonths } from 'date-fns'

interface County {
  county_fips: string
  county_name: string
  state: string
  source_refresh_date: string | null
  parcel_count: number
  last_imported: string
}

export default function CountiesPage() {
  const { getToken } = useAuth()
  const navigate = useNavigate()
  const [counties, setCounties] = useState<County[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  async function loadCounties() {
    setLoading(true)
    try {
      const token = await getToken()
      const res = await fetch('/api/v1/admin/parcels/counties', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to load counties')
      const { counties } = await res.json()
      setCounties(counties)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadCounties() }, [])

  async function handleDelete(county: County) {
    if (!confirm(`Delete all ${county.parcel_count.toLocaleString()} parcels for ${county.county_name}?`)) return
    setDeleting(county.county_fips)
    try {
      const token = await getToken()
      const res = await fetch(
        `/api/v1/admin/parcels/counties?county_fips=${county.county_fips}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
      )
      if (!res.ok) throw new Error('Delete failed')
      await loadCounties()
    } catch (err) {
      setError(String(err))
    } finally {
      setDeleting(null)
    }
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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">County Parcel Library</h1>
        <Link
          to="/admin/parcels/import"
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md"
        >
          + Import county
        </Link>
      </div>

      {error && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {counties.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg mb-2">No counties imported yet</p>
          <Link to="/admin/parcels/import" className="text-blue-600 text-sm underline">
            Import your first county
          </Link>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {['County', 'State', 'Refresh Date', 'Parcels', 'Last Imported', 'Actions'].map(
                  (h) => (
                    <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y">
              {counties.map((county) => {
                const isStale =
                  county.source_refresh_date &&
                  differenceInMonths(new Date(), new Date(county.source_refresh_date)) >= 12

                return (
                  <tr key={county.county_fips} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">
                      {county.county_name}
                      <span className="ml-1 text-xs text-gray-400">({county.county_fips})</span>
                    </td>
                    <td className="px-4 py-3">{county.state}</td>
                    <td className="px-4 py-3">
                      {county.source_refresh_date ?? '—'}
                      {isStale && (
                        <span className="ml-2 text-xs text-amber-600 font-medium">
                          Refresh recommended
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">{county.parcel_count.toLocaleString()}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {county.last_imported
                        ? formatDistanceToNow(new Date(county.last_imported), { addSuffix: true })
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            navigate(
                              `/admin/parcels/import?county_fips=${county.county_fips}&state=${county.state}&county_name=${encodeURIComponent(county.county_name)}`
                            )
                          }
                          className="text-blue-600 hover:underline text-xs"
                        >
                          Re-import
                        </button>
                        <button
                          onClick={() => handleDelete(county)}
                          disabled={deleting === county.county_fips}
                          className="text-red-500 hover:underline text-xs disabled:opacity-40"
                        >
                          {deleting === county.county_fips ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
