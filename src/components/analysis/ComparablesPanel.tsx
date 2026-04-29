import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

interface Comparable {
  property_id: string
  address: string
  city_state: string
  sqft: number
  service_offerings: string[]
  region: string
  distance_miles: number
  similarity_score: number
  similarity_reasons: string[]
}

interface ComparablesResponse {
  property_id: string
  property_summary: {
    address: string
    sqft: number
    service_offerings: string[]
    region: string
  }
  comparables: Comparable[]
  summary_text: string
}

export default function ComparablesPanel({ propertyId }: { propertyId: string }) {
  const { getToken } = useAuth()
  const [data, setData] = useState<ComparablesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const token = await getToken()
        const res = await fetch(`/api/analyses/properties/${propertyId}/comparables`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}))
          throw new Error(errBody.error ?? `HTTP ${res.status}`)
        }
        const json: ComparablesResponse = await res.json()
        if (!cancelled) setData(json)
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [propertyId, getToken])

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Comparable Properties</h2>

      {loading && <div className="text-sm text-gray-400">Loading comparables…</div>}
      {error && (
        <div className="text-sm text-red-600">
          Could not load comparables: {error}
        </div>
      )}

      {!loading && !error && data && (
        <>
          {data.comparables.length === 0 ? (
            <p className="text-sm text-gray-500">{data.summary_text}</p>
          ) : (
            <>
              <p className="text-xs text-gray-500 mb-3">{data.summary_text}</p>
              <div className="space-y-2">
                {data.comparables.map((c) => (
                  <Link
                    key={c.property_id}
                    to={`/properties/${c.property_id}`}
                    className="block border rounded-lg px-3 py-2.5 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-gray-900 truncate">{c.address}</div>
                        <div className="text-xs text-gray-500">
                          {c.city_state}
                          {c.sqft > 0 && ` · ${c.sqft.toLocaleString()} sqft`}
                          {c.distance_miles >= 0 && ` · ${c.distance_miles}mi`}
                        </div>
                        {c.similarity_reasons.length > 0 && (
                          <div className="text-xs text-gray-500 mt-0.5 italic">
                            {c.similarity_reasons.join(' · ')}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-xs text-gray-400 uppercase tracking-wide">Similarity</div>
                        <div className="font-semibold text-gray-900">
                          {(c.similarity_score * 100).toFixed(0)}%
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
