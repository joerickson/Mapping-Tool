// Per-client enrichment status + run button. Renders nothing when
// every property under (account, client) is already enriched. Surfaces
// pending+failed counts and lets the user kick off a scoped run.
import { useCallback, useEffect, useState } from 'react'
import { Loader2, MapPinOff, Sparkles, CheckCircle2 } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import Button from '../ui/Button'

interface Stats {
  total: number
  enriched: number
  pending: number
  failed: number
  no_coords: number
}

interface Props {
  clientId: string
  // Optional callback when an enrichment run completes (e.g. so a parent
  // page can re-fetch property lists).
  onEnriched?: () => void
}

export default function EnrichmentBanner({ clientId, onEnriched }: Props) {
  const { getToken } = useAuth()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchStats = useCallback(async () => {
    if (!clientId) return
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/clients/${clientId}/enrichment-status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`Status fetch failed: ${res.status}`)
      const data = (await res.json()) as Stats
      setStats(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [clientId, getToken])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  const runEnrichment = async () => {
    setRunning(true)
    setMessage(null)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/clients/${clientId}/enrichment-status`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error ?? `Enrichment failed: ${res.status}`)
      }
      if (data.message) {
        setMessage(data.message)
      } else {
        setMessage(
          `Enriched ${data.succeeded ?? 0}/${data.total ?? 0} properties.${
            data.failed ? ` ${data.failed} failed.` : ''
          }`
        )
      }
      await fetchStats()
      onEnriched?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  if (loading) return null
  if (!stats) return null
  // Hide entirely when there's nothing to do AND nothing to report.
  const everythingEnriched = stats.total > 0 && stats.pending === 0 && stats.failed === 0

  if (stats.total === 0) {
    return null
  }

  if (everythingEnriched && !message && !error) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-success/30 bg-success/5 px-4 py-2.5 text-sm">
        <div className="flex items-center gap-2 text-success">
          <CheckCircle2 className="h-4 w-4" />
          <span>
            All <span className="font-tabular">{stats.enriched}</span> properties enriched.
          </span>
        </div>
        {stats.no_coords > 0 && (
          <span className="text-xs text-fg-muted">
            {stats.no_coords} still missing coordinates
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/30 bg-warning/5 px-4 py-3">
      <div className="flex items-start gap-3 min-w-0">
        <MapPinOff className="h-4 w-4 text-warning shrink-0 mt-0.5" />
        <div className="space-y-0.5 min-w-0">
          <p className="text-sm font-medium text-fg">
            <span className="font-tabular">{stats.pending + stats.failed}</span>{' '}
            {stats.pending + stats.failed === 1 ? 'property needs' : 'properties need'} enrichment
          </p>
          <p className="text-xs text-fg-muted">
            Validates each address with Google + geocodes lat/lng so they show on the map and feed analyses.{' '}
            {stats.failed > 0 && (
              <>
                <span className="text-danger">{stats.failed} previously failed</span> — re-running may succeed if data was fixed.{' '}
              </>
            )}
            {stats.enriched > 0 && (
              <>
                ({stats.enriched}/{stats.total} already enriched.)
              </>
            )}
          </p>
          {message && <p className="text-xs text-success mt-1">{message}</p>}
          {error && <p className="text-xs text-danger mt-1">{error}</p>}
        </div>
      </div>
      <Button
        size="sm"
        onClick={runEnrichment}
        disabled={running || stats.pending + stats.failed === 0}
      >
        {running ? (
          <>
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            Enriching…
          </>
        ) : (
          <>
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            Enrich {stats.pending + stats.failed} pending
          </>
        )}
      </Button>
    </div>
  )
}
