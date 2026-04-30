// Phase 4e — preflight issues banner for a cycle. Shows blocking +
// unacknowledged warning/info issues with acknowledge buttons. Hides
// itself when nothing's open. Triggers a backend re-run on demand.
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Info, Loader2, RotateCcw, X } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import Button from '../ui/Button'
import { Badge } from '../ui/Badge'
import { cn } from '../../lib/cn'

interface PreflightIssue {
  id: string
  cycle_instance_id: string
  template_id: string
  check_type: string
  severity: 'blocking' | 'warning' | 'info'
  affected_count: number | null
  affected_entity_type: string | null
  description: string
  suggested_action: string | null
  acknowledged: boolean
  acknowledged_at: string | null
}

interface Props {
  cycleId: string
}

export default function PreflightIssuesBanner({ cycleId }: Props) {
  const { getToken } = useAuth()
  const [issues, setIssues] = useState<PreflightIssue[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [acking, setAcking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAcked, setShowAcked] = useState(false)

  const fetchIssues = useCallback(async () => {
    if (!cycleId) return
    setLoading(true)
    try {
      const token = await getToken()
      const res = await fetch(`/api/scheduler/cycles/${cycleId}/preflight`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`Preflight fetch failed: ${res.status}`)
      const j = await res.json()
      setIssues((j.issues ?? []) as PreflightIssue[])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [cycleId, getToken])

  useEffect(() => {
    fetchIssues()
  }, [fetchIssues])

  const reRun = async () => {
    setRunning(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/scheduler/cycles/${cycleId}/preflight`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as any).error ?? `Re-run failed: ${res.status}`)
      }
      await fetchIssues()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  const acknowledgeAll = async () => {
    setAcking(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/scheduler/cycles/${cycleId}/preflight-acknowledge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ acknowledge_all_warnings: true }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as any).error ?? `Ack failed: ${res.status}`)
      }
      await fetchIssues()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAcking(false)
    }
  }

  const ackOne = async (id: string) => {
    setError(null)
    try {
      const token = await getToken()
      await fetch(`/api/scheduler/cycles/${cycleId}/preflight-acknowledge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ issue_ids: [id] }),
      })
      await fetchIssues()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const open = issues.filter((i) => !i.acknowledged)
  const acked = issues.filter((i) => i.acknowledged)
  if (loading || (issues.length === 0 && !error)) return null

  const blocking = open.filter((i) => i.severity === 'blocking')
  const warnings = open.filter((i) => i.severity === 'warning')
  const info = open.filter((i) => i.severity === 'info')

  return (
    <div
      className={cn(
        'rounded-md border',
        blocking.length > 0
          ? 'border-danger/40 bg-danger/5'
          : 'border-warning/30 bg-warning/5'
      )}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-border/40">
        <div className="flex items-center gap-2">
          <AlertTriangle
            className={cn(
              'h-4 w-4 shrink-0',
              blocking.length > 0 ? 'text-danger' : 'text-warning'
            )}
          />
          <p className="text-sm font-medium text-fg">
            {open.length === 0
              ? `${acked.length} preflight issues — all acknowledged`
              : `${open.length} preflight issue${open.length === 1 ? '' : 's'} to review`}
          </p>
          {blocking.length > 0 && (
            <Badge variant="danger" className="text-[10px]">
              {blocking.length} blocking
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={reRun} disabled={running}>
            {running ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Re-running…
              </>
            ) : (
              <>
                <RotateCcw className="h-3 w-3 mr-1" /> Re-run checks
              </>
            )}
          </Button>
          {warnings.length + info.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={acknowledgeAll}
              disabled={acking}
            >
              {acking ? 'Ack…' : 'Acknowledge all warnings/info'}
            </Button>
          )}
        </div>
      </div>
      <ul className="divide-y divide-border/40">
        {open.map((i) => (
          <IssueRow key={i.id} issue={i} onAck={() => ackOne(i.id)} />
        ))}
      </ul>
      {error && <p className="px-4 py-2 text-xs text-danger">{error}</p>}
      {acked.length > 0 && (
        <details className="px-4 py-2 text-xs text-fg-muted" open={showAcked}>
          <summary
            onClick={(e) => {
              e.preventDefault()
              setShowAcked((v) => !v)
            }}
            className="cursor-pointer"
          >
            Acknowledged ({acked.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {acked.map((i) => (
              <li key={i.id} className="text-fg-subtle">
                <span className="font-tabular">{i.severity}</span> · {i.description}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function IssueRow({ issue, onAck }: { issue: PreflightIssue; onAck: () => void }) {
  const tone =
    issue.severity === 'blocking'
      ? 'text-danger'
      : issue.severity === 'warning'
        ? 'text-warning'
        : 'text-fg-muted'
  const Icon = issue.severity === 'info' ? Info : AlertTriangle
  return (
    <li className="px-4 py-2 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <Icon className={cn('h-3.5 w-3.5 shrink-0', tone)} />
          <span className={cn('font-medium uppercase text-[10px] tracking-wider', tone)}>
            {issue.severity}
          </span>
          <span className="text-fg">{issue.description}</span>
        </div>
        {issue.suggested_action && (
          <p className="text-xs text-fg-muted mt-0.5 ml-5">
            {issue.suggested_action}
          </p>
        )}
      </div>
      {issue.severity !== 'blocking' && (
        <Button size="sm" variant="ghost" onClick={onAck}>
          <X className="h-3 w-3 mr-1" />
          Acknowledge
        </Button>
      )}
    </li>
  )
}
