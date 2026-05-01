// Phase 4.5d — Branch Assignments panel.
// Renders the engine's per-property branch recommendation and lets
// operators override per-property. Overrides persist to
// routing_templates.branch_assignment_overrides; the operator must
// regenerate the template for them to affect the schedule.
import { useMemo, useState } from 'react'
import { Card, CardTitle, CardDescription } from '../ui/Card'
import { Input } from '../ui/Input'
import { Badge } from '../ui/Badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../ui/Table'
import { useAuth } from '../../hooks/useAuth'

interface Branch { name: string; lat: number; lng: number }

interface Assignment {
  service_location_id: string
  property_id: string
  address: string
  nearest_branch_idx: number
  assigned_branch_idx: number
  transferred: boolean
  overridden: boolean
  is_remote?: boolean
}

interface Props {
  templateId: string
  branches: Branch[]
  assignments: Assignment[]
  overrides: Record<string, number>
  onChanged: () => void
}

export default function BranchAssignmentsPanel({
  templateId,
  branches,
  assignments,
  overrides,
  onChanged,
}: Props) {
  const { getToken } = useAuth()
  const [filter, setFilter] = useState('')
  const [branchFilter, setBranchFilter] = useState<string>('all')
  const [showOnlyTransferred, setShowOnlyTransferred] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const counts = useMemo(() => {
    const transferred = assignments.filter((a) => a.transferred && !a.overridden).length
    const overridden = assignments.filter((a) => a.overridden).length
    const remote = assignments.filter((a) => a.is_remote).length
    return { total: assignments.length, transferred, overridden, remote }
  }, [assignments])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return assignments.filter((a) => {
      if (showOnlyTransferred && !a.transferred && !a.overridden) return false
      if (branchFilter !== 'all') {
        const target = Number(branchFilter)
        if (a.assigned_branch_idx !== target) return false
      }
      if (!q) return true
      return a.address.toLowerCase().includes(q)
    })
  }, [assignments, filter, branchFilter, showOnlyTransferred])

  const setOverride = async (
    serviceLocationId: string,
    branchIdx: number | null
  ) => {
    setSavingId(serviceLocationId)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(
        `/api/scheduler/templates/${templateId}/branch-overrides`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ service_location_id: serviceLocationId, branch_idx: branchIdx }),
        }
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as any).error ?? `HTTP ${res.status}`)
      }
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingId(null)
    }
  }

  const branchLabel = (idx: number) => branches[idx]?.name ?? `Branch ${idx}`

  return (
    <Card padding="none">
      <div className="border-b border-border px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <CardTitle>Branch assignments</CardTitle>
          <CardDescription>
            Engine's recommendation per property from the capacity-circle rebalance.
            Override to force a property to a specific branch — regenerate the template
            for the override to affect the schedule.
          </CardDescription>
        </div>
        <div className="flex items-center gap-3 text-xs text-fg-muted">
          <span><span className="font-tabular text-fg">{counts.total}</span> properties</span>
          <span>·</span>
          <span><span className="font-tabular text-fg">{counts.transferred}</span> auto-transferred</span>
          <span>·</span>
          <span><span className="font-tabular text-fg">{counts.overridden}</span> overridden</span>
          {counts.remote > 0 && (
            <>
              <span>·</span>
              <span><span className="font-tabular text-fg">{counts.remote}</span> remote</span>
            </>
          )}
        </div>
      </div>

      <div className="border-b border-border px-4 py-2 flex items-center gap-2 flex-wrap">
        <Input
          placeholder="Filter by address…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-xs h-8 text-xs"
        />
        <select
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
          className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-fg"
        >
          <option value="all">All branches</option>
          {branches.map((b, i) => (
            <option key={i} value={String(i)}>
              {b.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-fg-muted">
          <input
            type="checkbox"
            checked={showOnlyTransferred}
            onChange={(e) => setShowOnlyTransferred(e.target.checked)}
            className="rounded border-border accent-accent"
          />
          Only auto-transferred or overridden
        </label>
      </div>

      {error && (
        <p className="px-4 py-2 text-xs text-danger border-b border-danger/30 bg-danger-subtle">
          {error}
        </p>
      )}

      {filtered.length === 0 ? (
        <p className="px-4 py-6 text-sm text-fg-muted">No assignments match the current filter.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Property</TableHead>
              <TableHead>Engine recommendation</TableHead>
              <TableHead>Assigned branch</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.slice(0, 500).map((a) => {
              const overrideVal = overrides[a.service_location_id]
              const recommendedIdx =
                a.overridden
                  ? // engine echoes the override into assigned_branch_idx so
                    // we need a "what would engine pick" hint — use nearest
                    a.nearest_branch_idx
                  : a.assigned_branch_idx
              return (
                <TableRow key={a.service_location_id}>
                  <TableCell className="text-sm">
                    <p className="font-medium text-fg">{a.address}</p>
                    <p className="text-[11px] text-fg-subtle">
                      Nearest: {branchLabel(a.nearest_branch_idx)}
                      {a.transferred && !a.overridden && (
                        <span className="ml-1 text-warning">
                          → engine moved to {branchLabel(a.assigned_branch_idx)}
                        </span>
                      )}
                      {a.is_remote && (
                        <span className="ml-1 text-fg-muted">· remote (overnight)</span>
                      )}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={a.transferred ? 'warning' : 'outline'}
                      className="text-[10px]"
                    >
                      {branchLabel(recommendedIdx)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <select
                      value={overrideVal != null ? String(overrideVal) : 'auto'}
                      disabled={savingId === a.service_location_id || a.is_remote}
                      title={a.is_remote ? 'Remote properties auto-route to nearest branch' : undefined}
                      onChange={(e) => {
                        const v = e.target.value
                        setOverride(
                          a.service_location_id,
                          v === 'auto' ? null : Number(v)
                        )
                      }}
                      className={
                        'h-7 rounded-md border border-border bg-surface px-2 text-xs text-fg ' +
                        (a.is_remote ? 'opacity-50' : '')
                      }
                    >
                      <option value="auto">Auto (engine)</option>
                      {branches.map((b, i) => (
                        <option key={i} value={String(i)}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell className="text-right">
                    {a.overridden && (
                      <Badge variant="accent" className="text-[10px]">overridden</Badge>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
      {filtered.length > 500 && (
        <p className="px-4 py-2 text-xs text-fg-muted bg-surface-subtle border-t border-border">
          Showing first 500 of {filtered.length}. Filter to narrow the list.
        </p>
      )}
    </Card>
  )
}
