// Phase 3.9a — Branch property allocation dialog.
// Lets the user reassign properties from one branch to another (or
// revert to auto-assigned). Live recompute of per-branch property count
// + work hours + crew rec happens client-side so the user can preview
// the impact before hitting Save.
import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog'
import Button from '../ui/Button'
import { Input } from '../ui/Input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/Select'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/Table'
import { cn } from '../../lib/cn'

interface BranchInfo {
  name: string
  lat: number
  lng: number
  city_state?: string | null
}

interface PropertyRow {
  id: string
  address_line1: string | null
  city: string | null
  state: string | null
  latitude: number | null
  longitude: number | null
  branch_override: string | null
  service_locations?: Array<{ client_id: string | null; serviceable_sqft: number | null }>
}

interface Props {
  open: boolean
  onClose: () => void
  accountId: string
  clientId: string
  branches: BranchInfo[]
  // Per-property project-crew hours from Crew Strategy outputs, keyed
  // by property_id. Used to surface live work-hour totals per branch
  // as the user reassigns. If absent, the dialog still works but only
  // shows property counts (no hours).
  annualHoursByPropertyId?: Record<string, number>
  onSaved?: () => void
}

const AUTO = '__auto__' // sentinel for "use auto-assigned (clear override)"

function haversineMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 3958.8
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

function findNearestBranchIdx(
  p: { lat: number; lng: number },
  branches: BranchInfo[]
): number {
  let bestIdx = 0
  let bestDist = Infinity
  for (let i = 0; i < branches.length; i++) {
    const d = haversineMiles(p, { lat: branches[i].lat, lng: branches[i].lng })
    if (d < bestDist) {
      bestDist = d
      bestIdx = i
    }
  }
  return bestIdx
}

export default function BranchAllocationDialog({
  open,
  onClose,
  accountId: _accountId,
  clientId,
  branches,
  annualHoursByPropertyId = {},
  onSaved,
}: Props) {
  const { getToken } = useAuth()
  const [properties, setProperties] = useState<PropertyRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [filterBranch, setFilterBranch] = useState<string>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Pending overrides: id → branch name OR AUTO (reset). Properties not
  // in this map keep their server-side branch_override.
  const [pending, setPending] = useState<Map<string, string>>(new Map())
  const [moveTarget, setMoveTarget] = useState<string>(branches[0]?.name ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !clientId) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const token = await getToken()
        const res = await fetch(
          `/api/v1/properties?client_id=${clientId}&pageSize=2000`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (!res.ok) throw new Error(`Load failed: ${res.status}`)
        const data = (await res.json()) as { items?: PropertyRow[] }
        if (!cancelled) {
          setProperties(data.items ?? [])
          setPending(new Map())
          setSelected(new Set())
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [open, clientId, getToken])

  // Set default move target whenever branches change.
  useEffect(() => {
    if (branches[0] && !branches.some((b) => b.name === moveTarget)) {
      setMoveTarget(branches[0].name)
    }
  }, [branches, moveTarget])

  // Resolved branch per property (override → effective name; falls back to
  // auto-assigned nearest). pendingOverride lets the user preview moves
  // before saving.
  type Resolved = {
    p: PropertyRow
    auto_branch_name: string
    effective_branch_name: string
    is_override: boolean
    auto_drive_mi: number
  }
  const resolved = useMemo<Resolved[]>(() => {
    const branchByName = new Map(branches.map((b) => [b.name.toLowerCase(), b]))
    return properties.map((p) => {
      const lat = p.latitude
      const lng = p.longitude
      let autoIdx = 0
      let autoMi = 0
      if (lat != null && lng != null && branches.length > 0) {
        autoIdx = findNearestBranchIdx({ lat, lng }, branches)
        autoMi = haversineMiles(
          { lat, lng },
          { lat: branches[autoIdx].lat, lng: branches[autoIdx].lng }
        )
      }
      const autoName = branches[autoIdx]?.name ?? '(none)'
      const pendingOverride = pending.get(p.id)
      let effectiveOverride: string | null = null
      if (pendingOverride !== undefined) {
        effectiveOverride = pendingOverride === AUTO ? null : pendingOverride
      } else {
        effectiveOverride = p.branch_override ?? null
      }
      const effectiveName =
        effectiveOverride && branchByName.has(effectiveOverride.toLowerCase())
          ? effectiveOverride
          : autoName
      return {
        p,
        auto_branch_name: autoName,
        effective_branch_name: effectiveName,
        is_override: effectiveOverride != null && effectiveOverride !== autoName,
        auto_drive_mi: autoMi,
      }
    })
  }, [properties, branches, pending])

  // Live per-branch summary based on the resolved (override-aware) state.
  const branchSummary = useMemo(() => {
    const m = new Map<
      string,
      { count: number; hours: number; override_count: number; drive_sum: number; drive_n: number }
    >()
    for (const b of branches) {
      m.set(b.name, { count: 0, hours: 0, override_count: 0, drive_sum: 0, drive_n: 0 })
    }
    for (const r of resolved) {
      const row = m.get(r.effective_branch_name)
      if (!row) continue
      row.count += 1
      row.hours += annualHoursByPropertyId[r.p.id] ?? 0
      if (r.is_override) row.override_count += 1
      if (r.auto_drive_mi > 0) {
        row.drive_sum += r.auto_drive_mi
        row.drive_n += 1
      }
    }
    return m
  }, [resolved, branches, annualHoursByPropertyId])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return resolved.filter((r) => {
      if (filterBranch !== 'all' && r.effective_branch_name !== filterBranch) return false
      if (!q) return true
      const hay = `${r.p.address_line1 ?? ''} ${r.p.city ?? ''} ${r.p.state ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [resolved, filter, filterBranch])

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(r.p.id))

  const toggleAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) {
        for (const r of filtered) next.delete(r.p.id)
      } else {
        for (const r of filtered) next.add(r.p.id)
      }
      return next
    })
  }

  const stagePending = (target: string) => {
    if (selected.size === 0) return
    setPending((prev) => {
      const next = new Map(prev)
      for (const id of selected) next.set(id, target)
      return next
    })
    setSelected(new Set())
  }

  const pendingChanges = useMemo(() => {
    // Group by target → property_ids; null target means "auto" (clear).
    const byTarget = new Map<string | null, string[]>()
    for (const [id, target] of pending) {
      const original = properties.find((p) => p.id === id)?.branch_override ?? null
      const newVal = target === AUTO ? null : target
      if (newVal === original) continue // not actually a change
      const arr = byTarget.get(newVal) ?? []
      arr.push(id)
      byTarget.set(newVal, arr)
    }
    return byTarget
  }, [pending, properties])

  const totalPendingChanges = Array.from(pendingChanges.values()).reduce(
    (s, ids) => s + ids.length,
    0
  )

  const handleSave = async () => {
    if (totalPendingChanges === 0) return
    setSaving(true)
    setError(null)
    try {
      const token = await getToken()
      for (const [branchName, ids] of pendingChanges) {
        const res = await fetch('/api/v1/properties/bulk-reassign-branch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ property_ids: ids, branch_name: branchName }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error((j as any).error ?? `Save failed: ${res.status}`)
        }
      }
      onSaved?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Branch property allocations</DialogTitle>
          <DialogDescription>
            Reassign properties between branches to rebalance crew utilization. Changes are previewed below; nothing saves until you click Apply.
          </DialogDescription>
        </DialogHeader>

        {/* Per-branch summary cards (live preview) */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {branches.map((b) => {
            const s = branchSummary.get(b.name) ?? {
              count: 0,
              hours: 0,
              override_count: 0,
              drive_sum: 0,
              drive_n: 0,
            }
            const avgDrive = s.drive_n > 0 ? s.drive_sum / s.drive_n : 0
            return (
              <Card key={b.name} padding="sm" className="text-xs">
                <p className="font-semibold text-fg truncate">{b.name}</p>
                {b.city_state && (
                  <p className="text-fg-subtle truncate">{b.city_state}</p>
                )}
                <dl className="mt-2 grid grid-cols-2 gap-1.5">
                  <Stat label="Properties">
                    <span className="font-tabular">{s.count}</span>
                  </Stat>
                  <Stat label="Hours/yr">
                    <span className="font-tabular">{Math.round(s.hours).toLocaleString()}</span>
                  </Stat>
                  <Stat label="Avg drive">
                    <span className="font-tabular">{avgDrive.toFixed(1)}mi</span>
                  </Stat>
                  <Stat label="Overrides">
                    <span className="font-tabular">{s.override_count}</span>
                  </Stat>
                </dl>
              </Card>
            )
          })}
        </div>

        {/* Filter + select-all + bulk move */}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Filter by address / city / state…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="max-w-xs"
          />
          <Select value={filterBranch} onValueChange={setFilterBranch}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All branches</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.name} value={b.name}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-fg-muted">
            Showing {filtered.length} of {resolved.length}
          </span>
          <div className="flex-1" />
          <span className="text-xs text-fg-muted">
            <span className="font-tabular">{selected.size}</span> selected
          </span>
          <Select value={moveTarget} onValueChange={setMoveTarget}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Move to…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>(Auto-assigned / clear override)</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.name} value={b.name}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={selected.size === 0}
            onClick={() => stagePending(moveTarget)}
          >
            Move {selected.size > 0 ? selected.size : ''} →
          </Button>
        </div>

        {/* Properties table */}
        <div className="overflow-auto border border-border rounded-md flex-1 min-h-[200px]">
          {loading ? (
            <div className="flex items-center justify-center p-12 text-fg-muted">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Loading properties…
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleAllFiltered}
                      aria-label="Select all (filtered)"
                    />
                  </TableHead>
                  <TableHead>Property</TableHead>
                  <TableHead>Effective branch</TableHead>
                  <TableHead>Auto branch</TableHead>
                  <TableHead className="text-right">Drive (mi, auto)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const isSel = selected.has(r.p.id)
                  const pendingTarget = pending.get(r.p.id)
                  const isPending =
                    pendingTarget !== undefined &&
                    (pendingTarget === AUTO
                      ? r.p.branch_override != null
                      : r.p.branch_override !== pendingTarget)
                  return (
                    <TableRow
                      key={r.p.id}
                      className={cn(isPending && 'bg-warning/5')}
                    >
                      <TableCell className="w-8">
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => {
                            setSelected((prev) => {
                              const next = new Set(prev)
                              if (next.has(r.p.id)) next.delete(r.p.id)
                              else next.add(r.p.id)
                              return next
                            })
                          }}
                          aria-label={`Select ${r.p.address_line1 ?? r.p.id}`}
                        />
                      </TableCell>
                      <TableCell className="text-fg">
                        <p className="font-medium">{r.p.address_line1 ?? '—'}</p>
                        <p className="text-xs text-fg-muted">
                          {r.p.city}{r.p.city && r.p.state ? ', ' : ''}{r.p.state}
                        </p>
                      </TableCell>
                      <TableCell>
                        <span className="text-fg">{r.effective_branch_name}</span>
                        {r.is_override && (
                          <Badge variant="warning" className="ml-1.5 text-[10px]">
                            override
                          </Badge>
                        )}
                        {isPending && (
                          <Badge variant="success" className="ml-1.5 text-[10px]">
                            pending
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-fg-muted">
                        {r.auto_branch_name}
                      </TableCell>
                      <TableCell numeric className="text-fg-muted text-xs">
                        {r.auto_drive_mi > 0 ? r.auto_drive_mi.toFixed(1) : '—'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>

        {error && (
          <p className="text-sm text-danger">{error}</p>
        )}

        <DialogFooter className="gap-2">
          <span className="text-xs text-fg-muted self-center mr-auto">
            {totalPendingChanges} pending change{totalPendingChanges === 1 ? '' : 's'}.
            Saving stales Crew Strategy + Bid Pricing — re-run them after.
          </span>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || totalPendingChanges === 0}
            loading={saving}
          >
            Apply {totalPendingChanges > 0 ? `(${totalPendingChanges})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[9px] uppercase tracking-wider text-fg-subtle">{label}</dt>
      <dd className="text-fg">{children}</dd>
    </div>
  )
}
