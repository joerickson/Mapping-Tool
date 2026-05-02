// Rebalance suggestions dialog. Three suggestion types:
//   property_move  — patches template.branch_assignment_overrides
//   crew_relocate  — patches account_operational_constraints
//                    crew_count_per_branch_override (-1 origin, +1 target)
//   crew_reduce    — patches the same override (-1 from branch)
//
// Optional Claude advisor narrative at the top, with a ranked sequence
// of suggestion IDs to apply in order.
import { useEffect, useState } from 'react'
import { ArrowRight, Sparkles, Users, MapPin, Minus } from 'lucide-react'
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

type SuggestionType = 'property_move' | 'crew_relocate' | 'crew_reduce'

interface BaseSuggestion {
  id: string
  type: SuggestionType
  title: string
  summary: string
  priority: number
}
interface PropertyMoveSuggestion extends BaseSuggestion {
  type: 'property_move'
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
interface CrewRelocateSuggestion extends BaseSuggestion {
  type: 'crew_relocate'
  crew_index: number
  crew_label: string
  from_branch_name: string
  to_branch_name: string
  idle_days_freed: number
  expected_absorbed_count: number
}
interface CrewReduceSuggestion extends BaseSuggestion {
  type: 'crew_reduce'
  branch_name: string
  current_count: number
  proposed_count: number
  idle_days_freed: number
}
type Suggestion = PropertyMoveSuggestion | CrewRelocateSuggestion | CrewReduceSuggestion

interface Advisor {
  recommendation: string
  ranked_actions: string[]
}

interface Props {
  cycleId: string
  templateId: string
  open: boolean
  onClose: () => void
  onRegenerate: () => Promise<void>
}

const TYPE_META: Record<SuggestionType, { label: string; icon: any; color: string }> = {
  property_move: { label: 'Property move', icon: MapPin, color: 'accent' },
  crew_relocate: { label: 'Restage crew', icon: Users, color: 'warning' },
  crew_reduce: { label: 'Reduce crews', icon: Minus, color: 'danger' },
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
  const [advisor, setAdvisor] = useState<Advisor | null>(null)
  const [advisorLoading, setAdvisorLoading] = useState(false)
  const [applied, setApplied] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)

  const loadSuggestions = async (withAdvisor: boolean) => {
    setLoading(!withAdvisor)
    if (withAdvisor) setAdvisorLoading(true)
    setError(null)
    try {
      const token = await getToken()
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      }
      if (withAdvisor) headers['X-Advise'] = 'true'
      const res = await fetch(
        `/api/scheduler/cycles/${cycleId}/rebalance-suggestions`,
        { method: 'POST', headers, body: JSON.stringify({}) }
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((json as any).error ?? `HTTP ${res.status}`)
      setSuggestions((json as any).suggestions ?? [])
      if (withAdvisor) setAdvisor((json as any).advisor ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
      setAdvisorLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    setApplied(new Set())
    setAdvisor(null)
    void loadSuggestions(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cycleId])

  const apply = async (s: Suggestion) => {
    setApplying(s.id)
    setError(null)
    try {
      const token = await getToken()
      if (s.type === 'property_move') {
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
      } else if (s.type === 'crew_relocate') {
        const res = await fetch(
          `/api/scheduler/cycles/${cycleId}/apply-rebalance`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              type: 'crew_relocate',
              from_branch_name: s.from_branch_name,
              to_branch_name: s.to_branch_name,
            }),
          }
        )
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error((j as any).error ?? `HTTP ${res.status}`)
        }
      } else if (s.type === 'crew_reduce') {
        const res = await fetch(
          `/api/scheduler/cycles/${cycleId}/apply-rebalance`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              type: 'crew_reduce',
              branch_name: s.branch_name,
            }),
          }
        )
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error((j as any).error ?? `HTTP ${res.status}`)
        }
      }
      setApplied((prev) => new Set([...prev, s.id]))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setApplying(null)
    }
  }

  const applyAll = async () => {
    // If advisor ranked actions exist, follow that order.
    const queue =
      advisor?.ranked_actions
        ?.map((id) => suggestions.find((s) => s.id === id))
        .filter((s): s is Suggestion => !!s) ?? suggestions
    for (const s of queue) {
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
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Rebalance suggestions</DialogTitle>
          <DialogDescription>
            Three remediation types: <strong>property moves</strong> re-route
            unplaced clusters; <strong>restage crew</strong> relocates an idle
            crew's home branch to where the work is; <strong>reduce crews</strong>
            drops staffing where geography doesn't justify it. Apply any combination,
            then regenerate the template.
          </DialogDescription>
        </DialogHeader>

        {/* Advisor card */}
        <div className="rounded-md border border-accent/20 bg-accent-subtle/30 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-fg">
              <Sparkles className="h-3.5 w-3.5 text-accent" />
              AI advisor
            </div>
            {!advisor && !advisorLoading && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => loadSuggestions(true)}
                disabled={suggestions.length === 0 || loading}
              >
                Generate recommendation
              </Button>
            )}
          </div>
          {advisorLoading && (
            <p className="text-xs text-fg-muted">
              Synthesizing recommendation…
            </p>
          )}
          {!advisor && !advisorLoading && (
            <p className="text-xs text-fg-subtle">
              Have Claude rank these suggestions and explain trade-offs the
              engine can't see (labor cost vs capacity, setup overhead, etc.).
            </p>
          )}
          {advisor && (
            <>
              <p className="text-sm text-fg leading-relaxed">{advisor.recommendation}</p>
              {advisor.ranked_actions.length > 0 && (
                <p className="text-[11px] text-fg-subtle">
                  Recommended order: {advisor.ranked_actions.join(' → ')}
                </p>
              )}
            </>
          )}
        </div>

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
            <p className="text-sm text-fg">No automatic recommendations available.</p>
            <p className="text-xs text-fg-muted">
              Either every recipient is at capacity, the geography is too far,
              or no crew is severely idle. Use the Branch Assignments map view
              to manually reassign individual properties.
            </p>
          </div>
        )}

        {!loading && suggestions.length > 0 && (
          <ul className="space-y-2 max-h-96 overflow-y-auto py-1">
            {suggestions.map((s) => {
              const isApplied = applied.has(s.id)
              const isApplying = applying === s.id
              const meta = TYPE_META[s.type]
              const Icon = meta.icon
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
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge
                          variant={meta.color as any}
                          className="text-[10px] inline-flex items-center gap-1"
                        >
                          <Icon className="h-3 w-3" />
                          {meta.label}
                        </Badge>
                        <p className="text-sm font-semibold text-fg">{s.title}</p>
                      </div>
                      <p className="text-xs text-fg-muted">{s.summary}</p>
                      <SuggestionVisual s={s} />
                    </div>
                    {isApplied ? (
                      <Badge variant="success" className="text-[10px] flex-shrink-0">
                        Applied
                      </Badge>
                    ) : (
                      <Button size="sm" onClick={() => apply(s)} loading={isApplying}>
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
              <Button size="sm" onClick={regenerateAndClose} loading={regenerating}>
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

function SuggestionVisual({ s }: { s: Suggestion }) {
  if (s.type === 'property_move') {
    return (
      <div className="flex items-center gap-1 text-xs text-fg-muted">
        <Badge variant="outline" className="text-[10px]">{s.from_branch_name}</Badge>
        <ArrowRight className="h-3 w-3" />
        <Badge variant="accent" className="text-[10px]">{s.to_branch_name}</Badge>
        <span className="ml-1 font-tabular">
          {s.property_count} propert{s.property_count === 1 ? 'y' : 'ies'}
        </span>
      </div>
    )
  }
  if (s.type === 'crew_relocate') {
    return (
      <div className="flex items-center gap-1 text-xs text-fg-muted">
        <Badge variant="outline" className="text-[10px]">{s.crew_label} @ {s.from_branch_name}</Badge>
        <ArrowRight className="h-3 w-3" />
        <Badge variant="warning" className="text-[10px]">{s.to_branch_name}</Badge>
        <span className="ml-1 font-tabular">{s.idle_days_freed}d freed</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1 text-xs text-fg-muted">
      <Badge variant="danger" className="text-[10px]">
        {s.branch_name}: {s.current_count} → {s.proposed_count}
      </Badge>
      <span className="ml-1 font-tabular">~{s.idle_days_freed}d/crew freed</span>
    </div>
  )
}
