import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { Card, CardHeader, CardTitle } from '../ui/Card'
import { ErrorState } from '../ui/ErrorState'
import { Skeleton } from '../ui/Skeleton'
import { cn } from '../../lib/cn'

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

  // Bumped on retry to re-trigger the fetch effect.
  const [retryNonce, setRetryNonce] = useState(0)
  const retry = useCallback(() => setRetryNonce((n) => n + 1), [])

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
  }, [propertyId, getToken, retryNonce])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comparable properties</CardTitle>
      </CardHeader>

      <div className="mt-4">
        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        )}
        {error && (
          <ErrorState
            title="Couldn't load comparables"
            description={error}
            onRetry={retry}
          />
        )}

        {!loading && !error && data && (
          <>
            {data.comparables.length === 0 ? (
              <p className="text-sm text-fg-muted">{data.summary_text}</p>
            ) : (
              <>
                <p className="mb-3 text-xs text-fg-muted">{data.summary_text}</p>
                <ul className="space-y-2">
                  {data.comparables.map((c) => (
                    <li key={c.property_id}>
                      <Link
                        to={`/properties/${c.property_id}`}
                        className={cn(
                          'group block rounded-md border border-border bg-surface px-3 py-2.5',
                          'transition-colors duration-150',
                          'hover:bg-surface-muted hover:border-border-strong',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <p className="truncate text-sm font-medium text-fg">
                              {c.address}
                            </p>
                            <p className="text-xs text-fg-muted">
                              {c.city_state}
                              {c.sqft > 0 && (
                                <>
                                  {' · '}
                                  <span className="font-tabular">
                                    {c.sqft.toLocaleString()}
                                  </span>{' '}
                                  sqft
                                </>
                              )}
                              {c.distance_miles >= 0 && (
                                <>
                                  {' · '}
                                  <span className="font-tabular">
                                    {c.distance_miles}
                                  </span>
                                  mi
                                </>
                              )}
                            </p>
                            {c.similarity_reasons.length > 0 && (
                              <p className="text-xs italic text-fg-subtle">
                                {c.similarity_reasons.join(' · ')}
                              </p>
                            )}
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                              Similarity
                            </p>
                            <p className="font-mono text-base font-semibold tabular-nums text-fg">
                              {(c.similarity_score * 100).toFixed(0)}%
                            </p>
                          </div>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </Card>
  )
}
