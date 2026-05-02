// Phase 4.5j — Rebalance suggestions dialog.
// Shown after generate-cycle when there are unplaced visits. The
// /rebalance-suggestions endpoint returns deterministic recommendations
// like "Move Broken Arrow OK trip from Frisco → Sugar Land". The
// operator clicks Apply, we batch-override the affected properties on
// the template, and prompt to regenerate.
import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog'
import Button from '../ui/Button'
import { Badge } from '../ui/Badge'
import { useAuth } from '../../hooks/useAuth'

interface Suggestion {
  id: string
  title: string
  summary: string
  from_branch_idx: number
  from_branch_name: string
  to_branch_idx: number
  to_branch_name: string
  property_count: number
  service_location_ids: string[]
  property_ids: string[]
  cluster_label: string
  drive_delta_miles: number
}

interface Props {
  cycleId: string
  templateId: string
  open: boolean
  onClose: () => void
  // Called after the operator applies one or more recommendations and
  // chooses to regenerate. Parent triggers the regenerate API and
  // reloads cycle data.
  onRegenerate: () => Promise<void>
}

export default function RebalanceSuggestionsDialog({
  cycleId,
  templateId,
  open,
  onClose,
  onRegenerate,
}: Props) {
  const { getToken } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [applied, setApplied] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      setApplied(new Set())
      try {
        const token = await getToken()
        const res = await fetch(
          `/api/scheduler/cycles/${cycleId}/rebalance-suggestions`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({}),
          }
        )
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error((json as any).error ?? `HTTP ${res.status}`)
        if (!cancelled) setSuggestions((json as any).suggestions ?? [])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [open, cycleId, getToken])

  const apply = async (s: Suggestion) => {
    setApplying(s.id)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(
        `/api/scheduler/templates/${templateId}/branch-overrides`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            batch: s.service_location_ids.map((sl) => ({
              service_location_id: sl,
              branch_idx: s.to_branch_idx,
            })),
          }),
        }
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as any).error ?? `HTTP ${res.status}`)
      }
      setApplied((prev) => new Set([...prev, s.id]))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setApplying(null)
    }
  }

  const applyAll = async () => {
    for (const s of suggestions) {
      if (applied.has(s.id)) continue
      await apply(s)
    }
  }

  const regenerateAndClose = async () => {
    setRegenerating(true)
    try {
      await onRegenerate()
      onClose()
    } finally {
      setRegenerating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Rebalance suggestions</DialogTitle>
          <DialogDescription>
            Some properties didn't fit. Here's how we'd move trips to other
            branches that have idle capacity. Apply any you want; regenerate
            the template to put them into effect.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <p className="text-sm text-fg-muted py-4">Computing suggestions…</p>
        )}

        {error && (
          <p className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        {!loading && suggestions.length === 0 && !error && (
          <div className="py-3 space-y-2">
            <p className="text-sm text-fg">
              No automatic recommendations available.
            </p>
            <p className="text-xs text-fg-muted">
              Either every recipient is already at capacity, or the
              overflow is geographically too far for any other branch
              to absorb. Use the Branch Assignments map view to manually
              reassign individual properties, or extend the cycle / add
              a crew.
            </p>
          </div>
        )}

        {!loading && suggestions.length > 0 && (
          <ul className="space-y-2 max-h-96 overflow-y-auto py-1">
            {suggestions.map((s) => {
              const isApplied = applied.has(s.id)
              const isApplying = applying === s.id
              return (
                <li
                  key={s.id}
                  className={
                    'rounded-md border p-3 space-y-2 ' +
                    (isApplied
                      ? 'border-success/40 bg-success-subtle/40'
                      : 'border-border bg-surface')
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-fg flex items-center gap-2 flex-wrap">
                        {s.cluster_label}{' '}
                        <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
                          <Badge variant="outline" className="text-[10px]">
                            {s.from_branch_name}
                          </Badge>
                          <ArrowRight className="h-3 w-3" />
                          <Badge variant="accent" className="text-[10px]">
                            {s.to_branch_name}
                          </Badge>
                        </span>
                      </p>
                      <p className="text-xs text-fg-muted mt-1">{s.summary}</p>
                    </div>
                    {isApplied ? (
                      <Badge variant="success" className="text-[10px] flex-shrink-0">
                        Applied
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => apply(s)}
                        loading={isApplying}
                      >
                        Apply
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <DialogFooter>
          <div className="flex items-center gap-2 flex-wrap w-full">
            {suggestions.length > 0 && applied.size === 0 && (
              <Button variant="secondary" size="sm" onClick={applyAll}>
                Apply all
              </Button>
            )}
            {applied.size > 0 && (
              <Button
                size="sm"
                onClick={regenerateAndClose}
                loading={regenerating}
              >
                Regenerate template ({applied.size} applied)
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onClose} className="ml-auto">
              {applied.size > 0 ? 'Close (regenerate later)' : 'Skip'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
