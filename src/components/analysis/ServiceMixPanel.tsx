import { useEffect, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { Badge } from '../ui/Badge'
import { Card, CardHeader, CardTitle } from '../ui/Card'
import { Skeleton } from '../ui/Skeleton'

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

const CONFIDENCE_VARIANT: Record<
  Recommendation['confidence'],
  'success' | 'warning' | 'default'
> = {
  high: 'success',
  medium: 'warning',
  low: 'default',
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
    <Card>
      <CardHeader>
        <CardTitle>Service mix recommendation</CardTitle>
      </CardHeader>

      <div className="mt-4 space-y-4">
        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-md border border-danger/20 bg-danger-subtle px-3 py-2 text-sm text-danger"
          >
            Could not load service mix: {error}
          </p>
        )}

        {!loading && !error && data && (
          <>
            {data.current_offerings.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                  Current offerings
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {data.current_offerings.map((o) => (
                    <Badge key={o} variant="accent">
                      {o}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {data.recommended_additions.length === 0 ? (
              <p className="text-sm text-fg-muted">{data.summary_text}</p>
            ) : (
              <>
                <p className="text-xs text-fg-muted">{data.summary_text}</p>
                <ul className="space-y-2">
                  {data.recommended_additions.map((r) => (
                    <li
                      key={r.offering_name}
                      className="rounded-md border border-border bg-surface px-3 py-2.5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium text-fg">
                          {r.offering_name}
                        </p>
                        <Badge variant={CONFIDENCE_VARIANT[r.confidence]}>
                          {r.confidence} confidence
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-fg-muted">{r.rationale}</p>
                      <p className="mt-1 text-xs italic text-fg-subtle">
                        Est. value: {r.estimated_value}
                      </p>
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
