// AnalysisCard — per-module shell on the dashboard. Phase D2 migration:
// all chrome routed through design tokens; behavior unchanged so the
// dashboard's polling/stuck-detection/cache-key flow still works exactly
// the same. The caller still passes status / running / startedAt /
// lastPolledAt / lastPollError; this file just renders them.
import { ReactNode, useEffect, useState } from 'react'
import { CircleAlert, Loader2, TriangleAlert } from 'lucide-react'
import Button from '../ui/Button'
import { Badge } from '../ui/Badge'
import { StatusDot, type StatusVariant } from '../ui/StatusDot'
import { cn } from '../../lib/cn'

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
  // Tier-2 gate: when true, the Run button is disabled and the card shows a
  // placeholder explaining what's blocking the run (typically "Select branches
  // in Branch Optimization first").
  disabledReason?: string | null
  // Phase 3.5 — small "Using: $28/hr labor · 10 hr/day · …" line below the
  // description, with an "Edit assumptions" link that opens the Cost
  // Assumptions panel scrolled to the relevant group. The dashboard owns the
  // highlight-group state; the card just renders the line + click handler.
  usingLine?: ReactNode
  onEditAssumptions?: () => void
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
  disabledReason,
  usingLine,
  onEditAssumptions,
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

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-surface overflow-hidden',
        // Status-specific border emphasis. Subtle — keep the chrome quiet.
        status === 'stuck' && 'border-warning/40',
        status === 'failed' && 'border-danger/40',
        // Tier 2 gate (no branches selected): dim the whole card so it reads
        // as inert without losing readability.
        disabledReason && 'opacity-70'
      )}
    >
      <div className="px-6 py-5 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold tracking-tight text-fg">
              {title}
            </h3>
            <ModuleStatusBadge status={status} running={running} />
            {staleVsConstraints && status === 'completed' && (
              <Badge variant="warning">
                Constraints changed — re-run to update
              </Badge>
            )}
          </div>
          <p className="text-sm text-fg-muted">{description}</p>
          {usingLine && (
            <p className="flex items-center flex-wrap gap-x-1.5 text-xs text-fg-muted pt-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                Using:
              </span>
              <span>{usingLine}</span>
              {onEditAssumptions && (
                <button
                  type="button"
                  onClick={onEditAssumptions}
                  className="text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm px-0.5"
                >
                  Edit assumptions
                </button>
              )}
            </p>
          )}
          {completedAt && status === 'completed' && (
            <p className="text-xs text-fg-subtle pt-0.5">
              Last run {relativeTime(completedAt)} ·{' '}
              <span className="font-tabular">
                {new Date(completedAt).toLocaleString()}
              </span>
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant={status === 'completed' ? 'secondary' : 'primary'}
          onClick={onRun}
          loading={running && status !== 'stuck'}
          disabled={!!disabledReason || (running && status !== 'stuck')}
          title={disabledReason ?? undefined}
        >
          {status === 'completed'
            ? 'Re-run'
            : status === 'stuck' || status === 'failed'
              ? 'Retry'
              : 'Run analysis'}
        </Button>
      </div>

      {/* Tier-2 gate placeholder */}
      {disabledReason && (
        <div className="border-t border-border bg-surface-subtle px-6 py-3 text-sm text-fg-muted flex items-center gap-2">
          <CircleAlert className="h-4 w-4 shrink-0 text-fg-subtle" />
          {disabledReason}
        </div>
      )}

      {/* Live progress strip while running */}
      {(status === 'running' || status === 'stuck') && (
        <div
          className={cn(
            'border-t px-6 py-2.5 text-xs flex items-center gap-3 flex-wrap',
            status === 'stuck'
              ? 'border-warning/40 bg-warning-subtle text-warning'
              : 'border-border bg-accent-subtle text-accent'
          )}
        >
          {status === 'running' && (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          )}
          {status === 'stuck' && (
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          )}
          <span>
            {status === 'stuck' ? (
              <>
                No response for{' '}
                <span className="font-tabular">{elapsedSec}s</span>. The work
                likely failed silently or is still running on the server. Try{' '}
                <em>Check now</em>, or <em>Mark as failed</em> to clear it and retry.
              </>
            ) : (
              <>
                Running for{' '}
                <span className="font-tabular">{elapsedSec ?? 0}s</span>
                {sinceLastPollSec != null && (
                  <>
                    {' · '}last checked{' '}
                    <span className="font-tabular">{sinceLastPollSec}s</span> ago
                  </>
                )}
              </>
            )}
          </span>

          {analysisId && (
            <span className="font-mono text-[10px] opacity-60">
              id: {analysisId.slice(0, 8)}
            </span>
          )}

          <span className="ml-auto inline-flex gap-1.5">
            {onCheckNow && (
              <button
                type="button"
                onClick={onCheckNow}
                className="rounded-sm border border-current/30 px-2 py-0.5 hover:bg-surface/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
              >
                Check now
              </button>
            )}
            {status === 'stuck' && onMarkFailed && (
              <button
                type="button"
                onClick={onMarkFailed}
                className="rounded-sm border border-current/30 px-2 py-0.5 hover:bg-surface/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
              >
                Mark as failed
              </button>
            )}
          </span>
        </div>
      )}

      {/* Surfaced poll error (transient, while running) */}
      {lastPollError && (status === 'running' || status === 'stuck') && (
        <div className="border-t border-danger/20 bg-danger-subtle px-6 py-2 text-xs text-danger">
          Poll error: {lastPollError}
        </div>
      )}

      {/* Summary, only when completed */}
      {summary && status === 'completed' && (
        <div className="border-t border-border bg-surface-subtle px-6 py-3 text-sm text-fg leading-relaxed">
          {summary}
        </div>
      )}

      {/* Failure detail */}
      {errorMessage && status === 'failed' && (
        <div className="border-t border-danger/20 bg-danger-subtle px-6 py-3 text-sm text-danger space-y-1">
          <div className="font-medium">Analysis failed</div>
          <div className="font-mono text-xs whitespace-pre-wrap break-words">
            {errorMessage}
          </div>
        </div>
      )}

      {children && status === 'completed' && !disabledReason && (
        <div className="border-t border-border px-6 py-5">{children}</div>
      )}
    </div>
  )
}

// Status badge — uses the design Badge with the same color mapping the
// rest of the dashboard uses (StatusDot semantics).
function ModuleStatusBadge({
  status,
  running,
}: {
  status: AnalysisStatus
  running?: boolean
}) {
  if (status === 'idle') {
    return <Badge variant="default">Not run</Badge>
  }
  if (status === 'running' || running) {
    return (
      <Badge variant="accent" className="gap-1.5">
        <StatusDot variant="running" label={false} size="sm" />
        Running
      </Badge>
    )
  }
  if (status === 'stuck') {
    return (
      <Badge variant="warning" className="gap-1.5">
        <TriangleAlert className="h-3 w-3" /> Stuck
      </Badge>
    )
  }
  if (status === 'completed') {
    return <Badge variant="success">Completed</Badge>
  }
  return <Badge variant="danger">Failed</Badge>
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

// Quiet the unused-import warning for StatusVariant (re-exported for callers
// that mirror the same status semantics without re-deriving the union).
export type { StatusVariant }
