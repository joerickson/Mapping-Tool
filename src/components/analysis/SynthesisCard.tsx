import { useEffect, useState } from 'react'
import Button from '../ui/Button'
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
    <div className="bg-gradient-to-br from-indigo-50 via-blue-50 to-sky-50 rounded-xl border-2 border-indigo-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-indigo-900">Portfolio Synthesis</h3>
            {(running || row?.status === 'running' || row?.status === 'stale') && (
              <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 inline-flex items-center gap-1.5">
                <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Updating…
              </span>
            )}
            {!loading && row?.status === 'completed' && !isStale && (
              <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">Fresh</span>
            )}
            {!loading && row?.status === 'completed' && isStale && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-800">
                Stale — modules re-run since
              </span>
            )}
            {!loading && !row && (
              <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                Not synthesized
              </span>
            )}
            {!loading && row?.status === 'failed' && (
              <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">Failed</span>
            )}
          </div>
          <p className="text-sm text-indigo-700 mt-1">
            Combines all module outputs into an executive summary plus a downloadable
            structured report.
          </p>
          {row?.completed_at && (
            <p className="text-xs text-indigo-600/70 mt-1">
              Last synthesized {relativeTime(row.completed_at)}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {row?.status === 'completed' && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setReportOpen(true)}>
                View Full Report
              </Button>
              <Button variant="secondary" size="sm" onClick={downloadMarkdown}>
                Download Markdown
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

      {/* Dashboard summary text */}
      {row?.status === 'completed' && row.summary_text && (
        <div className="px-5 py-4 border-t border-indigo-200 bg-white/60">
          <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
            {row.summary_text}
          </div>
        </div>
      )}

      {/* Failure message */}
      {row?.status === 'failed' && row.error_message && (
        <div className="px-5 py-3 border-t bg-red-50 text-sm text-red-700">
          <div className="font-medium mb-0.5">Synthesis failed</div>
          <div className="font-mono text-xs whitespace-pre-wrap">{row.error_message}</div>
        </div>
      )}

      {error && (
        <div className="px-5 py-3 border-t bg-red-50 text-sm text-red-700">{error}</div>
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
          <p className="text-sm text-gray-500">No report content available.</p>
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
