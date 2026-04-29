import { useEffect, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'

interface Recommendation {
  offering_name: string
  rationale: string
  confidence: 'high' | 'medium' | 'low'
  estimated_value: string
}

interface ServiceMixResponse {
  property_id: string
  current_offerings: string[]
  cohort_size?: number
  cohort_scope?: 'region' | 'client'
  recommended_additions: Recommendation[]
  summary_text: string
}

const CONFIDENCE_BADGE: Record<Recommendation['confidence'], string> = {
  high: 'bg-green-100 text-green-700 border-green-200',
  medium: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  low: 'bg-gray-100 text-gray-700 border-gray-200',
}

export default function ServiceMixPanel({ propertyId }: { propertyId: string }) {
  const { getToken } = useAuth()
  const [data, setData] = useState<ServiceMixResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const token = await getToken()
        const res = await fetch(`/api/analyses/properties/${propertyId}/service-mix`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}))
          throw new Error(errBody.error ?? `HTTP ${res.status}`)
        }
        const json: ServiceMixResponse = await res.json()
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
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Service Mix Recommendation</h2>

      {loading && <div className="text-sm text-gray-400">Loading recommendations…</div>}
      {error && (
        <div className="text-sm text-red-600">Could not load service mix: {error}</div>
      )}

      {!loading && !error && data && (
        <>
          {data.current_offerings.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                Current offerings
              </div>
              <div className="flex flex-wrap gap-1.5">
                {data.current_offerings.map((o) => (
                  <span
                    key={o}
                    className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200"
                  >
                    {o}
                  </span>
                ))}
              </div>
            </div>
          )}

          {data.recommended_additions.length === 0 ? (
            <p className="text-sm text-gray-500">{data.summary_text}</p>
          ) : (
            <>
              <p className="text-xs text-gray-500 mb-2">{data.summary_text}</p>
              <div className="space-y-2">
                {data.recommended_additions.map((r) => (
                  <div key={r.offering_name} className="border rounded-lg px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium text-gray-900">{r.offering_name}</div>
                      <span
                        className={`text-xs px-2 py-0.5 rounded border font-medium ${
                          CONFIDENCE_BADGE[r.confidence]
                        }`}
                      >
                        {r.confidence} confidence
                      </span>
                    </div>
                    <div className="text-xs text-gray-600 mt-1">{r.rationale}</div>
                    <div className="text-xs text-gray-500 mt-1 italic">
                      Est. value: {r.estimated_value}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
