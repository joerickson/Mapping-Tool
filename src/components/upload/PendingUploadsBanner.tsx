// Per-client banner that lists upload batches which still need to be
// committed (or had partial-commit failures last time). Each batch has
// its own "Retry commit" button; on success the row removes itself
// from the list.
import { useCallback, useEffect, useState } from 'react'
import { Loader2, AlertTriangle, RotateCcw } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import Button from '../ui/Button'

interface PendingBatch {
  batch_id: string
  source_filename: string | null
  status: string
  row_count: number
  valid_count: number
  committed_count: number
  failure_count: number
  failure_reasons: string[]
  created_at: string
  committed_at: string | null
  reason: 'never_committed' | 'commit_failed_rows' | 'commit_short_of_valid'
}

interface Props {
  clientId: string
  onCommitted?: () => void
}

export default function PendingUploadsBanner({ clientId, onCommitted }: Props) {
  const { getToken } = useAuth()
  const [batches, setBatches] = useState<PendingBatch[]>([])
  const [loading, setLoading] = useState(true)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [perBatchMessage, setPerBatchMessage] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const fetchPending = useCallback(async () => {
    if (!clientId) return
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/clients/${clientId}/pending-uploads`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`Pending uploads fetch failed: ${res.status}`)
      const data = await res.json()
      setBatches(data.batches ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [clientId, getToken])

  useEffect(() => {
    fetchPending()
  }, [fetchPending])

  const retry = async (batch: PendingBatch) => {
    setRetryingId(batch.batch_id)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/uploads/${batch.batch_id}/commit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? `Retry failed: ${res.status}`)
      const newProps = Number(j.new_properties ?? 0)
      const existing = Number(j.existing_properties ?? 0)
      setPerBatchMessage((prev) => ({
        ...prev,
        [batch.batch_id]: `Committed ${newProps} new + ${existing} existing properties.`,
      }))
      // Refresh — completed batches drop off the list automatically.
      await fetchPending()
      onCommitted?.()
    } catch (err) {
      setPerBatchMessage((prev) => ({
        ...prev,
        [batch.batch_id]: err instanceof Error ? err.message : String(err),
      }))
    } finally {
      setRetryingId(null)
    }
  }

  if (loading || error) return null
  if (batches.length === 0) return null

  return (
    <div className="rounded-md border border-warning/30 bg-warning/5">
      <div className="px-4 py-2.5 border-b border-warning/20 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
        <p className="text-sm font-medium text-fg">
          {batches.length} upload{batches.length === 1 ? '' : 's'} still need
          {batches.length === 1 ? 's' : ''} to be committed
        </p>
      </div>
      <ul className="divide-y divide-warning/15">
        {batches.map((b) => {
          const isRetrying = retryingId === b.batch_id
          const remaining = Math.max(0, b.valid_count - b.committed_count)
          return (
            <li key={b.batch_id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg truncate">
                  {b.source_filename ?? '(no filename)'}
                </p>
                <p className="text-xs text-fg-muted mt-0.5">
                  <span className="font-tabular">{b.committed_count}</span>
                  {' / '}
                  <span className="font-tabular">{b.valid_count}</span> committed
                  {remaining > 0 && (
                    <>
                      {' · '}
                      <span className="text-warning font-tabular">{remaining}</span> remaining
                    </>
                  )}
                  {b.failure_count > 0 && (
                    <>
                      {' · '}
                      <span className="text-danger font-tabular">{b.failure_count}</span> failed last attempt
                    </>
                  )}
                  {' · '}
                  <span className="text-fg-subtle">
                    {new Date(b.created_at).toLocaleDateString()}
                  </span>
                </p>
                {b.failure_reasons.length > 0 && (
                  <details className="mt-1.5 text-xs text-fg-muted">
                    <summary className="cursor-pointer">Recent failure reasons</summary>
                    <ul className="mt-1 list-disc pl-5 space-y-0.5">
                      {b.failure_reasons.map((r, i) => (
                        <li key={i} className="font-mono break-all">
                          {r}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {perBatchMessage[b.batch_id] && (
                  <p className="text-xs mt-1 text-success">
                    {perBatchMessage[b.batch_id]}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => retry(b)}
                disabled={isRetrying || retryingId != null}
              >
                {isRetrying ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    Retrying…
                  </>
                ) : (
                  <>
                    <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                    Retry commit
                  </>
                )}
              </Button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
