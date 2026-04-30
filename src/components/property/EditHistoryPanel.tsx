// Collapsible audit-log panel for a property. Default closed — many
// properties will have lots of edits and we don't want to push the rest
// of the page down on every load.
import { useState, useCallback } from 'react'
import { ChevronDown } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { Card, CardTitle, CardDescription } from '../ui/Card'
import { cn } from '../../lib/cn'
import {
  PROPERTY_FIELDS,
  SERVICE_LOCATION_FIELDS,
} from '../../lib/editable-fields'

interface HistoryRow {
  id: string
  property_id: string
  service_location_id: string | null
  field_name: string
  old_value: unknown
  new_value: unknown
  changed_by: string | null
  changed_at: string
}

const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  [...PROPERTY_FIELDS, ...SERVICE_LOCATION_FIELDS].map((f) => [f.key, f.label])
)

interface Props {
  propertyId: string
}

export default function EditHistoryPanel({ propertyId }: Props) {
  const { getToken } = useAuth()
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<HistoryRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/properties/${propertyId}/edit-history`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`Load failed (${res.status})`)
      const json = (await res.json()) as { history: HistoryRow[] }
      setRows(json.history)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [propertyId, getToken])

  function toggle() {
    if (!open && rows == null) load()
    setOpen(!open)
  }

  return (
    <Card>
      <button
        type="button"
        onClick={toggle}
        className="flex items-start justify-between gap-3 w-full text-left"
      >
        <div className="space-y-1">
          <CardTitle>Edit history</CardTitle>
          <CardDescription>
            Audit log of property and service-location edits.
          </CardDescription>
        </div>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-fg-muted shrink-0 mt-1 transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>

      {open && (
        <div className="mt-4">
          {loading ? (
            <p className="text-sm text-fg-muted">Loading history…</p>
          ) : error ? (
            <p className="text-sm text-danger">{error}</p>
          ) : rows == null || rows.length === 0 ? (
            <p className="text-sm text-fg-muted">No edits recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="rounded-md border border-border bg-surface-subtle px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-fg">
                        {FIELD_LABELS[r.field_name] ?? r.field_name}
                      </span>
                      {r.service_location_id && (
                        <span className="text-[10px] uppercase tracking-wider text-fg-subtle bg-surface-elevated border border-border rounded px-1.5 py-0.5">
                          Service location
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-fg-subtle font-tabular">
                      {new Date(r.changed_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-1 text-xs flex items-baseline gap-2 flex-wrap">
                    <ValueChip value={r.old_value} variant="old" />
                    <span className="text-fg-subtle">→</span>
                    <ValueChip value={r.new_value} variant="new" />
                  </div>
                  {r.changed_by && (
                    <p className="mt-1 text-[11px] text-fg-subtle">By {r.changed_by}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}

function ValueChip({ value, variant }: { value: unknown; variant: 'old' | 'new' }) {
  const display = formatValue(value)
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 font-tabular text-xs max-w-full truncate',
        variant === 'old'
          ? 'bg-surface-elevated text-fg-muted line-through decoration-fg-subtle'
          : 'bg-accent/10 text-fg'
      )}
    >
      {display}
    </span>
  )
}

function formatValue(v: unknown): string {
  if (v == null) return '—'
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]'
    return `[${v.join(', ')}]`
  }
  if (typeof v === 'object') return JSON.stringify(v)
  if (typeof v === 'number') return v.toLocaleString()
  return String(v)
}
