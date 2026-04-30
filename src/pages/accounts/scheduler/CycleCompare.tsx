// Phase 4e — side-by-side cycle comparison.
//
// Route: /accounts/:accountId/clients/:clientId/scheduler/compare
//   ?template=<templateId>&left=<cycleId>&right=<cycleId>
//
// Two cycle dropdowns at the top, then a summary card with deltas, then
// added/removed/changed property lists. "Show only differences" filter
// hides identical-row sections.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import AppShell from '../../../components/layout/AppShell'
import Button from '../../../components/ui/Button'
import { Card, CardTitle, CardDescription } from '../../../components/ui/Card'
import { Badge } from '../../../components/ui/Badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/Select'
import { cn } from '../../../lib/cn'

interface Cycle {
  id: string
  cycle_number: number
  start_date: string
  end_date: string
  status: string
}

interface Delta {
  left: number
  right: number
  delta: number
  pct_change: number
}

interface ComparisonResponse {
  left: { cycle: any }
  right: { cycle: any }
  deltas: {
    total_visits: Delta
    total_drive_miles: Delta
    total_work_hours: Delta
    total_overnight_nights: Delta
    total_estimated_cost: Delta
    crews_used: Delta
    hard_constraint_violations: Delta
    soft_constraint_violations: Delta
    properties_added: string[]
    properties_removed: string[]
    properties_with_changed_crew: Array<{
      property_id: string
      left_crew: number | null
      right_crew: number | null
    }>
    properties_with_changed_date: Array<{
      property_id: string
      left_date: string | null
      right_date: string | null
    }>
  }
}

export default function CycleComparePage() {
  const { accountId, clientId } = useParams<{ accountId: string; clientId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { getToken } = useAuth()

  const templateId = searchParams.get('template') ?? ''
  const leftId = searchParams.get('left') ?? ''
  const rightId = searchParams.get('right') ?? ''

  const [cycles, setCycles] = useState<Cycle[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const [data, setData] = useState<ComparisonResponse | null>(null)
  const [loadingData, setLoadingData] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [onlyDiffs, setOnlyDiffs] = useState(false)

  // Load all cycles for the template so the dropdowns can populate.
  useEffect(() => {
    if (!templateId) return
    let cancelled = false
    const load = async () => {
      setLoadingList(true)
      try {
        const token = await getToken()
        const res = await fetch(
          `/api/scheduler/cycles?template_id=${encodeURIComponent(templateId)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (!res.ok) throw new Error(`Cycles fetch failed: ${res.status}`)
        const j = await res.json()
        if (!cancelled) setCycles((j.cycles ?? []) as Cycle[])
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoadingList(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [templateId, getToken])

  // Fetch the comparison once both ids are picked.
  const fetchComparison = useCallback(async () => {
    if (!leftId || !rightId || leftId === rightId) {
      setData(null)
      return
    }
    setLoadingData(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(
        `/api/scheduler/cycles/compare?left=${leftId}&right=${rightId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? `Compare failed: ${res.status}`)
      setData(j as ComparisonResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingData(false)
    }
  }, [leftId, rightId, getToken])

  useEffect(() => {
    fetchComparison()
  }, [fetchComparison])

  const setLeft = (id: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('left', id)
      return next
    })
  }
  const setRight = (id: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('right', id)
      return next
    })
  }

  const cycleLabel = (c: Cycle) =>
    `Cycle ${c.cycle_number}: ${c.start_date} → ${c.end_date}${
      c.status === 'completed' ? ' (✓)' : ''
    }`

  const sortedCycles = useMemo(
    () => [...cycles].sort((a, b) => a.cycle_number - b.cycle_number),
    [cycles]
  )

  return (
    <AppShell
      breadcrumb={[
        { label: 'Accounts', to: '/accounts' },
        { label: 'Scheduler', to: `/accounts/${accountId}/clients/${clientId}/scheduler` },
        { label: 'Compare cycles' },
      ]}
    >
      <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-fg">Compare cycles</h1>
            <p className="text-sm text-fg-muted mt-1">
              Pick two cycles from the same template to see deltas in visits, costs, drive miles, and crew assignments.
            </p>
          </div>
          {templateId && (
            <Link
              to={`/accounts/${accountId}/clients/${clientId}/scheduler/templates/${templateId}`}
              className="text-sm text-fg-muted hover:text-accent flex items-center gap-1"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to template
            </Link>
          )}
        </header>

        {/* Cycle pickers */}
        <Card padding="md">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-fg-subtle font-semibold mb-1">
                Left cycle
              </p>
              <Select value={leftId} onValueChange={setLeft}>
                <SelectTrigger>
                  <SelectValue placeholder={loadingList ? 'Loading…' : 'Pick a cycle'} />
                </SelectTrigger>
                <SelectContent>
                  {sortedCycles.map((c) => (
                    <SelectItem key={c.id} value={c.id} disabled={c.id === rightId}>
                      {cycleLabel(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-fg-subtle font-semibold mb-1">
                Right cycle
              </p>
              <Select value={rightId} onValueChange={setRight}>
                <SelectTrigger>
                  <SelectValue placeholder={loadingList ? 'Loading…' : 'Pick a cycle'} />
                </SelectTrigger>
                <SelectContent>
                  {sortedCycles.map((c) => (
                    <SelectItem key={c.id} value={c.id} disabled={c.id === leftId}>
                      {cycleLabel(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <label className="flex items-center gap-2 mt-3 text-sm text-fg-muted">
            <input
              type="checkbox"
              checked={onlyDiffs}
              onChange={(e) => setOnlyDiffs(e.target.checked)}
            />
            Show only differences
          </label>
        </Card>

        {error && (
          <div className="rounded-md border border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        {!error && !leftId && !rightId && !loadingData && (
          <Card padding="md">
            <CardTitle>Select two cycles to compare</CardTitle>
            <CardDescription>
              Use the dropdowns above. Cycles must come from the same template.
            </CardDescription>
          </Card>
        )}

        {loadingData && (
          <Card padding="md">
            <p className="text-sm text-fg-muted">Loading comparison…</p>
          </Card>
        )}

        {data && (
          <>
            <Card padding="md">
              <CardTitle>Summary</CardTitle>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-fg-subtle">
                      <th className="py-1.5">Metric</th>
                      <th className="py-1.5">Left</th>
                      <th className="py-1.5">Right</th>
                      <th className="py-1.5">Delta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    <DeltaRow label="Visits" d={data.deltas.total_visits} hideEqual={onlyDiffs} />
                    <DeltaRow
                      label="Cost"
                      d={data.deltas.total_estimated_cost}
                      hideEqual={onlyDiffs}
                      format="money"
                    />
                    <DeltaRow
                      label="Drive miles"
                      d={data.deltas.total_drive_miles}
                      hideEqual={onlyDiffs}
                    />
                    <DeltaRow
                      label="Work hours"
                      d={data.deltas.total_work_hours}
                      hideEqual={onlyDiffs}
                    />
                    <DeltaRow
                      label="Overnight nights"
                      d={data.deltas.total_overnight_nights}
                      hideEqual={onlyDiffs}
                    />
                    <DeltaRow label="Crews used" d={data.deltas.crews_used} hideEqual={onlyDiffs} />
                    <DeltaRow
                      label="Hard constraint violations"
                      d={data.deltas.hard_constraint_violations}
                      hideEqual={onlyDiffs}
                      worseHigher
                    />
                    <DeltaRow
                      label="Soft constraint violations"
                      d={data.deltas.soft_constraint_violations}
                      hideEqual={onlyDiffs}
                      worseHigher
                    />
                  </tbody>
                </table>
              </div>
            </Card>

            <Card padding="md">
              <CardTitle>Property changes</CardTitle>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <PropList
                  title={`+ ${data.deltas.properties_added.length} added`}
                  ids={data.deltas.properties_added}
                  variant="success"
                />
                <PropList
                  title={`− ${data.deltas.properties_removed.length} removed`}
                  ids={data.deltas.properties_removed}
                  variant="danger"
                />
              </div>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-fg-subtle font-semibold mb-2">
                    Crew reassigned ({data.deltas.properties_with_changed_crew.length})
                  </p>
                  <ul className="text-xs text-fg-muted space-y-0.5 max-h-40 overflow-y-auto">
                    {data.deltas.properties_with_changed_crew.slice(0, 50).map((c) => (
                      <li key={c.property_id} className="font-mono break-all">
                        {c.property_id.slice(0, 8)}: crew {c.left_crew ?? '—'} → {c.right_crew ?? '—'}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-fg-subtle font-semibold mb-2">
                    Date changed ({data.deltas.properties_with_changed_date.length})
                  </p>
                  <ul className="text-xs text-fg-muted space-y-0.5 max-h-40 overflow-y-auto">
                    {data.deltas.properties_with_changed_date.slice(0, 50).map((c) => (
                      <li key={c.property_id} className="font-mono break-all">
                        {c.property_id.slice(0, 8)}: {c.left_date ?? '—'} → {c.right_date ?? '—'}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  )
}

function DeltaRow({
  label,
  d,
  hideEqual,
  format,
  worseHigher,
}: {
  label: string
  d: Delta
  hideEqual: boolean
  format?: 'money'
  worseHigher?: boolean
}) {
  if (hideEqual && d.delta === 0) return null
  const fmt = (n: number) =>
    format === 'money' ? `$${Math.round(n).toLocaleString()}` : n.toLocaleString()
  const arrow = d.delta === 0 ? <Minus className="h-3 w-3" /> : d.delta > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
  // Direction colour: by default, increases are neutral; for "worseHigher"
  // metrics (constraint violations), increases are red.
  const tone = d.delta === 0
    ? 'text-fg-muted'
    : worseHigher
      ? d.delta > 0
        ? 'text-danger'
        : 'text-success'
      : d.delta > 0
        ? 'text-warning'
        : 'text-success'
  return (
    <tr>
      <td className="py-1.5 text-fg-muted">{label}</td>
      <td className="py-1.5 font-tabular">{fmt(d.left)}</td>
      <td className="py-1.5 font-tabular">{fmt(d.right)}</td>
      <td className={cn('py-1.5 font-tabular flex items-center gap-1', tone)}>
        {arrow}
        {d.delta === 0 ? '—' : `${d.delta > 0 ? '+' : ''}${fmt(d.delta)} (${d.pct_change > 0 ? '+' : ''}${d.pct_change.toFixed(1)}%)`}
      </td>
    </tr>
  )
}

function PropList({
  title,
  ids,
  variant,
}: {
  title: string
  ids: string[]
  variant: 'success' | 'danger'
}) {
  return (
    <div>
      <p
        className={cn(
          'text-[10px] uppercase tracking-wider font-semibold mb-2',
          variant === 'success' ? 'text-success' : 'text-danger'
        )}
      >
        <Badge variant={variant}>{title}</Badge>
      </p>
      <ul className="text-xs text-fg-muted space-y-0.5 max-h-40 overflow-y-auto">
        {ids.length === 0 && <li className="text-fg-subtle italic">None</li>}
        {ids.slice(0, 50).map((id) => (
          <li key={id} className="font-mono break-all">
            {id}
          </li>
        ))}
        {ids.length > 50 && (
          <li className="text-fg-subtle italic">… {ids.length - 50} more</li>
        )}
      </ul>
    </div>
  )
}
