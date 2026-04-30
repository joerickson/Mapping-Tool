import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Lock } from 'lucide-react'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog'
import { Badge } from '../ui/Badge'
import Button from '../ui/Button'
import { Input } from '../ui/Input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/Table'
import { useAuth } from '../../hooks/useAuth'
import { cn } from '../../lib/cn'

export interface ExistingBranch {
  name: string
  address?: string | null
  lat: number
  lng: number
  locked?: boolean
}

export interface SelectedBranch {
  name: string
  address?: string | null
  city_state: string
  lat: number
  lng: number
  source: 'existing' | 'manual'
  cluster_index?: number | null
  // Phase 3.9 — main vs satellite drives different overhead defaults.
  branch_type?: 'main' | 'satellite'
}

export interface ReferenceCentroid {
  city_state: string
  lat: number
  lng: number
  property_count?: number
  locked?: boolean
}

interface Props {
  open: boolean
  onClose: () => void
  k: number
  existingBranches: ExistingBranch[]
  referenceCentroids: ReferenceCentroid[]
  sourceAnalysisId: string | null
  onConfirm: (payload: {
    k: number
    branches: SelectedBranch[]
    source_analysis_id: string | null
  }) => Promise<void>
}

interface PlacesMatch {
  formatted: string
  name: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  lat: number
  lng: number
  place_id: string | null
}

type RowDraft =
  | { kind: 'empty' }
  | { kind: 'filled'; branch: SelectedBranch }

export default function BuildSelectionModal({
  open,
  onClose,
  k,
  existingBranches,
  referenceCentroids,
  sourceAnalysisId,
  onConfirm,
}: Props) {
  const initialRows = useMemo<RowDraft[]>(() => {
    const rows: RowDraft[] = []
    // Phase 3.9 — first existing branch defaults to 'main', subsequent
    // existing branches and any new manual rows default to 'satellite'.
    // K=1 forces 'main'.
    for (let i = 0; i < Math.min(existingBranches.length, k); i++) {
      const eb = existingBranches[i]
      rows.push({
        kind: 'filled',
        branch: {
          name: eb.name,
          address: eb.address ?? null,
          city_state: '',
          lat: eb.lat,
          lng: eb.lng,
          source: 'existing',
          branch_type: i === 0 ? 'main' : 'satellite',
        },
      })
    }
    while (rows.length < k) rows.push({ kind: 'empty' })
    if (k === 1 && rows[0]?.kind === 'filled') {
      rows[0] = {
        kind: 'filled',
        branch: { ...rows[0].branch, branch_type: 'main' },
      }
    }
    return rows
  }, [existingBranches, k])

  const [rows, setRows] = useState<RowDraft[]>(initialRows)
  const [activePicker, setActivePicker] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setRows(initialRows)
      setActivePicker(null)
      setConfirming(false)
      setError(null)
    }
  }, [open, initialRows])

  const lockedCount = existingBranches.length

  const setBranchAt = (idx: number, branch: SelectedBranch) => {
    setRows((cur) =>
      cur.map((r, i) =>
        i === idx
          ? {
              kind: 'filled',
              branch: {
                // Default new manual rows to 'satellite' (most additions
                // to a multi-branch portfolio are satellites). K=1 ⇒ 'main'.
                branch_type: k === 1 ? 'main' : ('satellite' as const),
                ...branch,
              },
            }
          : r
      )
    )
    setActivePicker(null)
  }
  const setBranchTypeAt = (idx: number, branch_type: 'main' | 'satellite') => {
    setRows((cur) =>
      cur.map((r, i) =>
        i === idx && r.kind === 'filled'
          ? { kind: 'filled', branch: { ...r.branch, branch_type } }
          : r
      )
    )
  }

  const clearBranchAt = (idx: number) => {
    if (idx < lockedCount) return
    setRows((cur) => cur.map((r, i) => (i === idx ? { kind: 'empty' } : r)))
  }

  const handleConfirm = async () => {
    setError(null)
    const filled: SelectedBranch[] = []
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (r.kind !== 'filled') {
        setError(
          `Row ${i + 1} is missing a location. Click "Set location" to choose one.`
        )
        return
      }
      filled.push(r.branch)
    }

    setConfirming(true)
    try {
      await onConfirm({ k, branches: filled, source_analysis_id: sourceAnalysisId })
    } catch (err: any) {
      setError(err?.message ?? String(err))
    } finally {
      setConfirming(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configure your K={k} branch locations</DialogTitle>
          <DialogDescription>
            You're selecting {k} branches. Specify each location below. Existing
            branches from your operational constraints are pre-filled and locked
            — remove them from Infrastructure first if you don't want them.
          </DialogDescription>
        </DialogHeader>

        {/* Branch rows */}
        <div className="rounded-md border border-border bg-surface overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>City / state</TableHead>
                <TableHead>Lat / lng</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, idx) => {
                const isLocked = idx < lockedCount
                return (
                  <TableRow key={idx}>
                    <TableCell className="text-fg-subtle font-tabular">
                      {idx + 1}
                    </TableCell>
                    <TableCell>
                      {isLocked ? (
                        <Badge variant="accent" className="gap-1">
                          <Lock className="h-3 w-3" /> Existing
                        </Badge>
                      ) : row.kind === 'filled' ? (
                        <Badge>Manual</Badge>
                      ) : (
                        <span className="text-xs text-fg-subtle">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.kind === 'filled' ? (
                        <div className="inline-flex rounded-md border border-border overflow-hidden text-[10px]">
                          <button
                            type="button"
                            onClick={() => setBranchTypeAt(idx, 'main')}
                            className={
                              'px-2 py-0.5 transition ' +
                              ((row.branch.branch_type ?? 'main') === 'main'
                                ? 'bg-accent text-white'
                                : 'text-fg-muted hover:bg-surface-subtle')
                            }
                          >
                            Main
                          </button>
                          <button
                            type="button"
                            onClick={() => setBranchTypeAt(idx, 'satellite')}
                            className={
                              'px-2 py-0.5 transition ' +
                              (row.branch.branch_type === 'satellite'
                                ? 'bg-accent text-white'
                                : 'text-fg-muted hover:bg-surface-subtle')
                            }
                          >
                            Satellite
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-fg-subtle">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium text-fg">
                      {row.kind === 'filled' ? (
                        row.branch.name
                      ) : (
                        <span className="text-fg-subtle">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {row.kind === 'filled' && row.branch.city_state ? (
                        row.branch.city_state
                      ) : (
                        <span className="text-fg-subtle">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-fg-subtle">
                      {row.kind === 'filled' && row.branch.lat && row.branch.lng ? (
                        `${row.branch.lat.toFixed(4)}, ${row.branch.lng.toFixed(4)}`
                      ) : (
                        <span className="font-sans text-fg-subtle">not set</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {isLocked ? (
                        <span className="text-xs text-fg-subtle">locked</span>
                      ) : (
                        <span className="inline-flex gap-3">
                          {row.kind === 'filled' && (
                            <button
                              type="button"
                              onClick={() => clearBranchAt(idx)}
                              className="rounded-sm text-xs text-danger hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                              Clear
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setActivePicker(idx)}
                            className="rounded-sm text-xs text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            {row.kind === 'filled' ? 'Change' : 'Set location'}
                          </button>
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>

        {/* Active picker */}
        {activePicker != null && (
          <LocationPicker
            onSelect={(branch) => setBranchAt(activePicker, branch)}
            onCancel={() => setActivePicker(null)}
          />
        )}

        {/* Reference centroids — DO NOT pre-fill into form */}
        {referenceCentroids.length > 0 && (
          <details className="group rounded-md border border-border bg-surface-subtle px-3 py-2">
            <summary
              className={cn(
                'flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-fg',
                'list-none [&::-webkit-details-marker]:hidden'
              )}
            >
              <ChevronDown className="h-3.5 w-3.5 -rotate-90 text-fg-muted transition-transform group-open:rotate-0" />
              Optimization-suggested centroids for K={k}
            </summary>
            <p className="mt-2 text-xs text-fg-muted">
              These are the centroids the k-means optimization landed on. Use them
              as reference; your locations don't need to match exactly.
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {referenceCentroids.map((c, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 text-fg"
                >
                  <span className="inline-flex items-center gap-2">
                    <span className="font-mono text-xs text-fg-subtle">
                      cluster {i + 1}:
                    </span>
                    {c.city_state}
                    {c.locked && <Badge variant="accent">locked</Badge>}
                    {typeof c.property_count === 'number' && (
                      <span className="text-xs text-fg-subtle">
                        <span className="font-tabular">{c.property_count}</span>{' '}
                        properties
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-xs text-fg-subtle">
                    {c.lat.toFixed(3)}, {c.lng.toFixed(3)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-md border border-danger/20 bg-danger-subtle px-3 py-2 text-sm text-danger"
          >
            {error}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" size="sm" disabled={confirming}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            size="sm"
            onClick={handleConfirm}
            loading={confirming}
            disabled={confirming}
          >
            Confirm selection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline location picker — debounced server-side autocomplete
// ─────────────────────────────────────────────────────────────────────────────

function LocationPicker({
  onSelect,
  onCancel,
}: {
  onSelect: (branch: SelectedBranch) => void
  onCancel: () => void
}) {
  const { getToken } = useAuth()
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<PlacesMatch[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [branchName, setBranchName] = useState('')
  const [chosen, setChosen] = useState<PlacesMatch | null>(null)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    if (query.trim().length < 2) {
      setMatches([])
      return
    }
    debounceRef.current = window.setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const token = await getToken()
        const res = await fetch(
          `/api/places/lookup?q=${encodeURIComponent(query.trim())}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(json.error ?? `HTTP ${res.status}`)
          setMatches([])
          return
        }
        setMatches(json.matches ?? [])
      } catch (err: any) {
        setError(err?.message ?? String(err))
        setMatches([])
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, getToken])

  const handleConfirm = () => {
    if (!chosen) return
    const cityState =
      chosen.city && chosen.state
        ? `${chosen.city}, ${chosen.state}`
        : chosen.formatted
    onSelect({
      name: branchName.trim() || cityState,
      address: chosen.formatted,
      city_state: cityState,
      lat: chosen.lat,
      lng: chosen.lng,
      source: 'manual',
    })
  }

  return (
    <div className="rounded-md border border-accent/20 bg-accent-subtle p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
        Set location
      </p>

      <Input
        type="text"
        autoFocus
        placeholder="Type a city or address (e.g. Houston TX, 1234 Main St San Antonio TX)"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setChosen(null)
        }}
      />

      {loading && <p className="mt-2 text-xs text-fg-muted">Searching…</p>}
      {error && <p className="mt-2 text-xs text-danger">Error: {error}</p>}

      {matches.length > 0 && (
        <ul className="mt-2 max-h-48 divide-y divide-border overflow-y-auto rounded-md border border-border bg-surface">
          {matches.map((m, i) => {
            const isChosen = chosen?.place_id === m.place_id && !!m.place_id
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => setChosen(m)}
                  className={cn(
                    'w-full px-3 py-2 text-left text-sm transition-colors',
                    'hover:bg-surface-muted',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
                    isChosen && 'bg-accent-subtle'
                  )}
                >
                  <p className="truncate font-medium text-fg">{m.formatted}</p>
                  <p className="text-xs text-fg-muted">
                    {m.city ?? '—'}, {m.state ?? '—'} ·{' '}
                    <span className="font-mono">
                      {m.lat.toFixed(4)}, {m.lng.toFixed(4)}
                    </span>
                  </p>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {chosen && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
          <Input
            type="text"
            placeholder={
              chosen.city && chosen.state
                ? `Branch name (defaults to ${chosen.city}, ${chosen.state})`
                : 'Branch name'
            }
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
          />
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleConfirm}>
            Use this location
          </Button>
        </div>
      )}

      {!chosen && (
        <div className="mt-2 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}
