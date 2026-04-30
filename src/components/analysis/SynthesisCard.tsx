import { useEffect, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import Button from '../ui/Button'
import { Badge } from '../ui/Badge'
import SlideOver from '../ui/SlideOver'
import MarkdownView from './MarkdownView'
import { useAuth } from '../../hooks/useAuth'

interface SynthesisRow {
  id: string
  // Phase 3.5 added 'stale' as a status set by triggerSynthesisRefresh whenever
  // any upstream change invalidates the existing synthesis. The card auto-
  // triggers a fresh /synthesize when it sees this and shows an "Updating…"
  // spinner until it resolves.
  status: 'completed' | 'failed' | 'running' | 'pending' | 'stale'
  outputs: any
  summary_text: string | null
  completed_at: string | null
  error_message: string | null
}

interface Props {
  accountId: string
  clientId: string
  hasSelection: boolean
  // ISO timestamps of the most recent module runs — used to flag the synthesis
  // as stale if any of them is newer than the synthesis row's completed_at.
  latestModuleCompletedAts: Array<string | null>
}

export default function SynthesisCard({
  accountId,
  clientId,
  hasSelection,
  latestModuleCompletedAts,
}: Props) {
  const { getToken } = useAuth()
  const [row, setRow] = useState<SynthesisRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    setLoading(true)
    try {
      const token = await getToken()
      const res = await fetch(
        `/api/analyses/account/${accountId}/clients/${clientId}/latest`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!res.ok) return
      const rows = (await res.json()) as Array<any>
      const synth = rows.find((r) => r.module_key === 'synthesis')
      setRow(synth ?? null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, clientId])

  // Phase 3.5 — poll /synthesis-status every 5s. Auto-trigger a fresh
  // synthesize when the row goes stale (any upstream change marks it). If
  // completed_at advances since the last refetch, pull the new content.
  useEffect(() => {
    if (!hasSelection) return
    let cancelled = false
    let lastSeenCompletedAt: string | null = row?.completed_at ?? null
    const tick = async () => {
      try {
        const token = await getToken()
        const res = await fetch(
          `/api/accounts/${accountId}/clients/${clientId}/synthesis-status`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (!res.ok || cancelled) return
        const status = await res.json()
        // Stale + no run in flight + we're not already kicking one off →
        // auto-refresh.
        if (
          status.status === 'stale' &&
          !status.current_run_started_at &&
          !running
        ) {
          await synthesize()
          return
        }
        // Completed_at advanced since the last seen value → refetch the row.
        if (
          status.last_synthesis_completed_at &&
          status.last_synthesis_completed_at !== lastSeenCompletedAt
        ) {
          lastSeenCompletedAt = status.last_synthesis_completed_at
          await refresh()
        }
      } catch {
        /* ignore */
      }
    }
    const interval = setInterval(tick, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, clientId, row?.completed_at, running, hasSelection])

  const synthesize = async () => {
    setRunning(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/analyses/account/${accountId}/clients/${clientId}/synthesize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? `HTTP ${res.status}`)
        return
      }
      // Fetch the freshly written row
      await refresh()
    } catch (err: any) {
      setError(err?.message ?? String(err))
    } finally {
      setRunning(false)
    }
  }

  const downloadMarkdown = async () => {
    const token = await getToken()
    // Use a manual fetch + blob to attach the auth header (cannot use plain href)
    const res = await fetch(
      `/api/analyses/account/${accountId}/clients/${clientId}/synthesis-download`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) {
      setError(`Download failed: HTTP ${res.status}`)
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = inferFilename(res.headers.get('Content-Disposition'))
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  // Stale: synthesis exists but its completed_at is older than at least one
  // of the modules feeding it.
  const isStale =
    row?.status === 'completed' &&
    row.completed_at &&
    latestModuleCompletedAts.some(
      (iso) => iso && new Date(iso) > new Date(row.completed_at!)
    )

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <div className="px-6 py-5 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <Sparkles className="h-4 w-4 text-accent" aria-hidden />
            <h3 className="text-base font-semibold tracking-tight text-fg">
              Portfolio Synthesis
            </h3>
            {(running || row?.status === 'running' || row?.status === 'stale') && (
              <Badge variant="accent" className="gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                Updating…
              </Badge>
            )}
            {!loading && row?.status === 'completed' && !isStale && (
              <Badge variant="success">Fresh</Badge>
            )}
            {!loading && row?.status === 'completed' && isStale && (
              <Badge variant="warning">Stale — modules re-run since</Badge>
            )}
            {!loading && !row && <Badge variant="default">Not synthesized</Badge>}
            {!loading && row?.status === 'failed' && (
              <Badge variant="danger">Failed</Badge>
            )}
          </div>
          <p className="text-sm text-fg-muted">
            Combines all module outputs into an executive summary plus a downloadable
            structured report.
          </p>
          {row?.completed_at && (
            <p className="text-xs text-fg-subtle">
              Last synthesized {relativeTime(row.completed_at)}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {row?.status === 'completed' && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setReportOpen(true)}>
                View full report
              </Button>
              <Button variant="ghost" size="sm" onClick={downloadMarkdown}>
                Download
              </Button>
            </>
          )}
          <Button
            size="sm"
            onClick={synthesize}
            loading={running}
            disabled={running || !hasSelection}
            title={
              !hasSelection
                ? 'Select branches first to enable Tier 2 modules. Synthesis needs all module outputs to be useful.'
                : undefined
            }
          >
            {row?.status === 'completed' ? 'Re-synthesize' : 'Synthesize'}
          </Button>
        </div>
      </div>

      {/* Dashboard summary text. Whitespace-pre-wrap so the synthesizer's
          paragraph breaks render naturally. */}
      {row?.status === 'completed' && row.summary_text && (
        <div className="border-t border-border bg-surface-subtle px-6 py-4">
          <div className="text-sm text-fg leading-relaxed whitespace-pre-wrap">
            {row.summary_text}
          </div>
        </div>
      )}

      {/* Failure message */}
      {row?.status === 'failed' && row.error_message && (
        <div className="border-t border-danger/20 bg-danger-subtle px-6 py-3 text-sm text-danger space-y-1">
          <div className="font-medium">Synthesis failed</div>
          <div className="font-mono text-xs whitespace-pre-wrap">
            {row.error_message}
          </div>
        </div>
      )}

      {error && (
        <div className="border-t border-danger/20 bg-danger-subtle px-6 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {/* Slide-over report */}
      <SlideOver
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title="Portfolio Analysis — Full Report"
        side="right"
      >
        {row?.outputs?.full_report_markdown ? (
          <MarkdownView source={row.outputs.full_report_markdown} />
        ) : (
          <p className="text-sm text-fg-muted">No report content available.</p>
        )}
      </SlideOver>
    </div>
  )
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 'just now'
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hr ago`
  const day = Math.floor(hr / 24)
  return `${day} day${day === 1 ? '' : 's'} ago`
}

function inferFilename(disposition: string | null): string {
  if (!disposition) return 'analysis.md'
  const m = /filename="([^"]+)"/.exec(disposition)
  return m?.[1] ?? 'analysis.md'
}
