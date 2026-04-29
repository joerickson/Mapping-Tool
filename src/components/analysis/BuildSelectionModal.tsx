import { useEffect, useMemo, useRef, useState } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import { useAuth } from '../../hooks/useAuth'

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
  referenceCentroids: ReferenceCentroid[] // optimization-suggested, NEVER auto-filled
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
  // Build initial rows: locked existing branches first, blanks for the rest.
  const initialRows = useMemo<RowDraft[]>(() => {
    const rows: RowDraft[] = []
    for (const eb of existingBranches.slice(0, k)) {
      rows.push({
        kind: 'filled',
        branch: {
          name: eb.name,
          address: eb.address ?? null,
          city_state: '',
          lat: eb.lat,
          lng: eb.lng,
          source: 'existing',
        },
      })
    }
    while (rows.length < k) rows.push({ kind: 'empty' })
    return rows
  }, [existingBranches, k])

  const [rows, setRows] = useState<RowDraft[]>(initialRows)
  const [activePicker, setActivePicker] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset state whenever the modal re-opens (e.g. user closes and reopens for
  // a different K).
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
      cur.map((r, i) => (i === idx ? { kind: 'filled', branch } : r))
    )
    setActivePicker(null)
  }

  const clearBranchAt = (idx: number) => {
    if (idx < lockedCount) return // locked rows can't be cleared
    setRows((cur) => cur.map((r, i) => (i === idx ? { kind: 'empty' } : r)))
  }

  const handleConfirm = async () => {
    setError(null)
    const filled: SelectedBranch[] = []
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (r.kind !== 'filled') {
        setError(`Row ${i + 1} is missing a location. Click "Set location" to choose one.`)
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
    <Modal open={open} onClose={onClose} title={`Configure your K=${k} branch locations`} size="xl">
      <p className="text-sm text-gray-500 mb-4">
        You're selecting {k} branches. Specify each location below. Existing branches from
        your operational constraints are pre-filled and locked — remove them from
        Infrastructure first if you don't want them.
      </p>

      {/* Branch rows */}
      <div className="border rounded-lg overflow-hidden mb-4">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="text-left px-3 py-2 w-8">#</th>
              <th className="text-left px-3 py-2">Source</th>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-left px-3 py-2">City / State</th>
              <th className="text-left px-3 py-2">Lat / Lng</th>
              <th className="text-right px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const isLocked = idx < lockedCount
              return (
                <tr key={idx} className="border-t">
                  <td className="px-3 py-2 text-gray-400">{idx + 1}</td>
                  <td className="px-3 py-2">
                    {isLocked ? (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                        🔒 Existing
                      </span>
                    ) : row.kind === 'filled' ? (
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700">
                        Manual
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-medium text-gray-900">
                    {row.kind === 'filled' ? row.branch.name : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    {row.kind === 'filled' && row.branch.city_state ? row.branch.city_state : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-500">
                    {row.kind === 'filled' && row.branch.lat && row.branch.lng
                      ? `${row.branch.lat.toFixed(4)}, ${row.branch.lng.toFixed(4)}`
                      : <span className="font-sans text-gray-400">not set</span>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {isLocked ? (
                      <span className="text-xs text-gray-400">locked</span>
                    ) : (
                      <>
                        {row.kind === 'filled' && (
                          <button
                            type="button"
                            onClick={() => clearBranchAt(idx)}
                            className="text-xs text-red-600 hover:underline mr-3"
                          >
                            Clear
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setActivePicker(idx)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          {row.kind === 'filled' ? 'Change' : 'Set location'}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
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
        <details className="border rounded-lg p-3 mb-4">
          <summary className="cursor-pointer text-sm font-semibold text-gray-700">
            Optimization suggested centroids for K={k}
          </summary>
          <p className="text-xs text-gray-500 mt-2">
            These are the centroids the k-means optimization landed on. Use them as
            reference; your locations don't need to match exactly.
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {referenceCentroids.map((c, i) => (
              <li key={i} className="flex items-center justify-between gap-3 text-gray-700">
                <div>
                  <span className="text-xs font-mono text-gray-400 mr-2">cluster {i + 1}:</span>
                  {c.city_state}
                  {c.locked && (
                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                      locked
                    </span>
                  )}
                  {typeof c.property_count === 'number' && (
                    <span className="ml-2 text-xs text-gray-400">
                      {c.property_count} properties
                    </span>
                  )}
                </div>
                <span className="font-mono text-xs text-gray-400">
                  {c.lat.toFixed(3)}, {c.lng.toFixed(3)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Footer */}
      <div className="border-t pt-4 mt-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-red-600 min-w-0 flex-1">{error}</div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={confirming}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleConfirm} loading={confirming} disabled={confirming}>
            Confirm Selection
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline location picker — debounced server-side autocomplete via /api/places/lookup
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

  // Debounced lookup
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
    <div className="border-2 border-blue-200 bg-blue-50/30 rounded-lg p-3 mb-4">
      <div className="text-xs font-semibold text-blue-800 uppercase tracking-wide mb-2">
        Set location
      </div>

      <input
        type="text"
        autoFocus
        placeholder="Type a city or address (e.g. Houston TX, 1234 Main St San Antonio TX)"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setChosen(null)
        }}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      {loading && <div className="text-xs text-gray-500 mt-2">Searching…</div>}
      {error && <div className="text-xs text-red-600 mt-2">Error: {error}</div>}

      {matches.length > 0 && (
        <div className="mt-2 max-h-48 overflow-y-auto border rounded bg-white divide-y">
          {matches.map((m, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setChosen(m)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                chosen?.place_id === m.place_id && m.place_id ? 'bg-blue-50' : ''
              }`}
            >
              <div className="font-medium text-gray-900 truncate">{m.formatted}</div>
              <div className="text-xs text-gray-500">
                {m.city ?? '—'}, {m.state ?? '—'} · {m.lat.toFixed(4)}, {m.lng.toFixed(4)}
              </div>
            </button>
          ))}
        </div>
      )}

      {chosen && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
          <input
            type="text"
            placeholder={
              chosen.city && chosen.state
                ? `Branch name (defaults to ${chosen.city}, ${chosen.state})`
                : 'Branch name'
            }
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <Button variant="secondary" size="sm" onClick={onCancel}>
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
