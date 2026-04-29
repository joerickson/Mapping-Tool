import { ReactNode, useEffect, useState } from 'react'
import { clsx } from 'clsx'
import Button from '../ui/Button'

export type AnalysisStatus = 'idle' | 'running' | 'completed' | 'failed' | 'stuck'

interface AnalysisCardProps {
  title: string
  description: string
  status: AnalysisStatus
  completedAt?: string | null
  errorMessage?: string | null
  summary?: string | null
  onRun: () => void
  running?: boolean
  // Feedback metadata
  startedAt?: number | null         // ms epoch when this run started (client-side)
  lastPolledAt?: number | null      // ms epoch when polling last got a response
  lastPollError?: string | null     // last poll-time error, if any
  analysisId?: string | null        // for "running" / "stuck" diagnostics
  onCheckNow?: () => void           // force-poll affordance
  onMarkFailed?: () => void         // shown when status === 'stuck'
  // Stale-vs-constraints flag — true when constraints.updated_at is newer
  // than the most recent completed run for this module.
  staleVsConstraints?: boolean
  children?: ReactNode              // expanded content — visible only when completed
}

// Threshold for treating a still-"running" row as stuck. Tuned to be longer
// than the 60s function timeout — anything past this is almost certainly a
// killed background task or a row that never wrote a terminal state.
export const STUCK_AFTER_MS = 90_000

export default function AnalysisCard({
  title,
  description,
  status,
  completedAt,
  errorMessage,
  summary,
  onRun,
  running,
  startedAt,
  lastPolledAt,
  lastPollError,
  analysisId,
  onCheckNow,
  onMarkFailed,
  staleVsConstraints,
  children,
}: AnalysisCardProps) {
  // Re-render every second so elapsed counters tick.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (status !== 'running' && status !== 'stuck') return
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [status])

  const elapsedSec = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : null
  const sinceLastPollSec = lastPolledAt ? Math.floor((Date.now() - lastPolledAt) / 1000) : null

  const statusBadge = (() => {
    switch (status) {
      case 'idle':
        return <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">Not run</span>
      case 'running':
        return (
          <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 inline-flex items-center gap-1.5">
            <Spinner />
            Running
          </span>
        )
      case 'stuck':
        return (
          <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800 inline-flex items-center gap-1.5">
            ⚠ Stuck
          </span>
        )
      case 'completed':
        return <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">Completed</span>
      case 'failed':
        return <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">Failed</span>
    }
  })()

  return (
    <div
      className={clsx('bg-white rounded-xl border shadow-sm overflow-hidden', {
        'border-amber-300': status === 'stuck',
        'border-red-300': status === 'failed',
      })}
    >
      <div className="px-5 py-4 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-gray-900">{title}</h3>
            {statusBadge}
            {staleVsConstraints && status === 'completed' && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 border border-yellow-200">
                Constraints changed since last run — re-run to update
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">{description}</p>
          {completedAt && status === 'completed' && (
            <p className="text-xs text-gray-400 mt-1">
              Last run {relativeTime(completedAt)} · {new Date(completedAt).toLocaleString()}
            </p>
          )}
        </div>
        <Button
          variant={status === 'completed' ? 'secondary' : 'primary'}
          size="sm"
          onClick={onRun}
          loading={running && status !== 'stuck'}
          disabled={running && status !== 'stuck'}
        >
          {status === 'completed' ? 'Re-run' : status === 'stuck' || status === 'failed' ? 'Retry' : 'Run analysis'}
        </Button>
      </div>

      {/* Live progress strip while running */}
      {(status === 'running' || status === 'stuck') && (
        <div
          className={clsx('px-5 py-2.5 border-t text-xs flex items-center gap-3 flex-wrap', {
            'bg-blue-50 text-blue-800': status === 'running',
            'bg-amber-50 text-amber-900': status === 'stuck',
          })}
        >
          {status === 'running' && <Spinner />}
          <span>
            {status === 'stuck' ? (
              <>
                No response for {elapsedSec}s. The work likely failed silently or is still running on
                the server. Try <em>Check now</em>, or <em>Mark as failed</em> to clear it and retry.
              </>
            ) : (
              <>
                Running for <span className="font-mono">{elapsedSec ?? 0}s</span>
                {sinceLastPollSec != null && (
                  <>
                    {' · '}last checked <span className="font-mono">{sinceLastPollSec}s</span> ago
                  </>
                )}
              </>
            )}
          </span>

          {analysisId && (
            <span className="font-mono text-[10px] opacity-60">id: {analysisId.slice(0, 8)}</span>
          )}

          <span className="ml-auto inline-flex gap-2">
            {onCheckNow && (
              <button
                type="button"
                onClick={onCheckNow}
                className="px-2 py-0.5 rounded border border-current/30 hover:bg-white/40"
              >
                Check now
              </button>
            )}
            {status === 'stuck' && onMarkFailed && (
              <button
                type="button"
                onClick={onMarkFailed}
                className="px-2 py-0.5 rounded border border-current/30 hover:bg-white/40"
              >
                Mark as failed
              </button>
            )}
          </span>
        </div>
      )}

      {/* Surfaced poll error (transient, while running) */}
      {lastPollError && (status === 'running' || status === 'stuck') && (
        <div className="px-5 py-2 border-t bg-red-50 text-xs text-red-700">
          Poll error: {lastPollError}
        </div>
      )}

      {/* Summary, only when completed */}
      {summary && status === 'completed' && (
        <div className="px-5 py-3 border-t bg-gray-50 text-sm text-gray-700">{summary}</div>
      )}

      {/* Failure detail */}
      {errorMessage && status === 'failed' && (
        <div className="px-5 py-3 border-t bg-red-50 text-sm text-red-700">
          <div className="font-medium mb-0.5">Analysis failed</div>
          <div className="font-mono text-xs whitespace-pre-wrap break-words">{errorMessage}</div>
        </div>
      )}

      {children && status === 'completed' && (
        <div className="border-t px-5 py-4">{children}</div>
      )}
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
  if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`
  return `${Math.floor(day / 30)} mo ago`
}

function Spinner() {
  return (
    <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}
