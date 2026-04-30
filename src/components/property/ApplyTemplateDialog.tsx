// ApplyTemplateDialog — bulk-apply a template's constraints to many
// service locations at once.
//
// Append-only: the API does NOT delete existing constraints on the
// selected SLs. If a user wants a clean slate they delete first.
import { useState, useEffect, useMemo } from 'react'
import { Search, Check } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import Button from '../ui/Button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/Dialog'
import { Input } from '../ui/Input'
import { Badge } from '../ui/Badge'
import { cn } from '../../lib/cn'
import type { ConstraintTemplate } from './EditTemplateDialog'

interface SLRow {
  service_location_id: string
  display_name: string | null
  property: { state: string | null; city: string | null } | null
  status: string
}

interface Props {
  open: boolean
  onClose: () => void
  accountId: string
  clientId: string
  template: ConstraintTemplate | null
  onApplied: () => void
}

export default function ApplyTemplateDialog({
  open,
  onClose,
  accountId: _accountId,
  clientId,
  template,
  onApplied,
}: Props) {
  const { getToken } = useAuth()
  const [sls, setSls] = useState<SLRow[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    applied: number
    sls: number
    failed: number
  } | null>(null)

  useEffect(() => {
    if (!open) return
    setSelected(new Set())
    setFilter('')
    setError(null)
    setResult(null)
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const token = await getToken()
        const res = await fetch(`/api/v1/service-locations?client_id=${clientId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error(`Load failed (${res.status})`)
        const data = (await res.json()) as SLRow[]
        if (!cancelled) setSls(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [open, clientId, getToken])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return sls
    return sls.filter((sl) => {
      const name = (sl.display_name ?? '').toLowerCase()
      const city = (sl.property?.city ?? '').toLowerCase()
      const state = (sl.property?.state ?? '').toLowerCase()
      return name.includes(q) || city.includes(q) || state.includes(q)
    })
  }, [sls, filter])

  function toggleAll(checked: boolean) {
    if (checked) {
      setSelected(new Set(filtered.map((sl) => sl.service_location_id)))
    } else {
      setSelected(new Set())
    }
  }
  function toggleOne(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  async function handleApply() {
    if (!template || selected.size === 0) return
    setSubmitting(true)
    setError(null)
    setResult(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/service-locations/bulk-apply-constraints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          service_location_ids: Array.from(selected),
          template_id: template.id,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const detail = Array.isArray(body.details) ? ` — ${body.details.join('; ')}` : ''
        throw new Error(`${body.error ?? `Apply failed (${res.status})`}${detail}`)
      }
      const body = (await res.json()) as {
        applied: Array<{ service_location_id: string; inserted_count: number }>
        failed: Array<{ service_location_id: string; error: string }>
      }
      const totalRows = body.applied.reduce((n, a) => n + a.inserted_count, 0)
      setResult({
        applied: totalRows,
        sls: body.applied.length,
        failed: body.failed.length,
      })
      if (body.failed.length === 0) {
        // Auto-close on full success after a beat so the user sees the toast.
        setTimeout(() => onApplied(), 1200)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (!template) return null

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((sl) => selected.has(sl.service_location_id))

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Apply &quot;{template.name}&quot;</DialogTitle>
          <DialogDescription>
            Will append {template.constraints.length} constraint
            {template.constraints.length === 1 ? '' : 's'} to each selected service location.
            Existing constraints are not touched.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-subtle" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name, city, or state…"
              className="pl-8"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-fg-muted whitespace-nowrap cursor-pointer">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={(e) => toggleAll(e.target.checked)}
              className="rounded border-border accent-accent"
            />
            Select all ({filtered.length})
          </label>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto rounded-md border border-border">
          {loading ? (
            <p className="p-4 text-sm text-fg-muted">Loading service locations…</p>
          ) : filtered.length === 0 ? (
            <p className="p-4 text-sm text-fg-muted">
              {sls.length === 0 ? 'No service locations in this client.' : 'No matches.'}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((sl) => {
                const checked = selected.has(sl.service_location_id)
                return (
                  <li key={sl.service_location_id}>
                    <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-surface-subtle">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOne(sl.service_location_id)}
                        className="rounded border-border accent-accent"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-fg truncate">
                          {sl.display_name ?? sl.service_location_id.slice(0, 8)}
                        </p>
                        <p className="text-xs text-fg-subtle">
                          {sl.property?.city ? `${sl.property.city}, ${sl.property.state}` : '—'}
                        </p>
                      </div>
                      <Badge variant="outline">{sl.status}</Badge>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {result && (
          <div
            className={cn(
              'flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
              result.failed === 0
                ? 'border-success/40 bg-success/5 text-fg'
                : 'border-warning/40 bg-warning/5 text-fg'
            )}
          >
            <Check className="h-4 w-4 text-success shrink-0 mt-0.5" />
            <span>
              Applied{' '}
              <span className="font-tabular font-medium">{result.applied}</span> constraint rows to{' '}
              <span className="font-tabular font-medium">{result.sls}</span> service location
              {result.sls === 1 ? '' : 's'}.
              {result.failed > 0 && ` ${result.failed} failed.`}
            </span>
          </div>
        )}

        {error && <p className="text-xs text-danger">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={handleApply} loading={submitting} disabled={selected.size === 0}>
            Apply to {selected.size} service location{selected.size === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
