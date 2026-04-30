// Phase 4b — properties admin list with bulk-edit.
// Route: /accounts/:accountId/clients/:clientId/admin/properties
//
// Lists every property under (account, client) with checkbox per row. The
// action bar appears once 1+ rows are selected and offers add-tag / remove-tag
// / set-notes operations that POST through /api/properties/bulk-edit.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Search, Tag, Trash2, FileText } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import AppShell from '../../components/layout/AppShell'
import Button from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Card, CardTitle } from '../../components/ui/Card'
import { Input, Textarea, FormField } from '../../components/ui/Input'
import { EmptyState } from '../../components/ui/EmptyState'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../components/ui/Dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/Table'

interface PropertyRow {
  id: string
  address_line1: string
  city: string
  state: string
  postal_code: string
  internal_tags: string[] | null
  notes: string | null
}

type BulkAction = 'add_tag' | 'remove_tag' | 'set_notes' | null

export default function PropertiesAdminPage() {
  const { accountId, clientId } = useParams<{ accountId: string; clientId: string }>()
  const { getToken } = useAuth()

  const [rows, setRows] = useState<PropertyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [action, setAction] = useState<BulkAction>(null)
  const [actionValue, setActionValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [resultToast, setResultToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!accountId || !clientId) return
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(
        `/api/v1/properties?client_id=${clientId}&limit=500`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!res.ok) throw new Error(`Load failed (${res.status})`)
      const data = await res.json()
      const list: PropertyRow[] = (data.properties ?? []).map((p: any) => ({
        id: p.id ?? p.property_id,
        address_line1: p.address_line1,
        city: p.city,
        state: p.state,
        postal_code: p.postal_code,
        internal_tags: p.internal_tags ?? [],
        notes: p.notes ?? null,
      }))
      setRows(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [accountId, clientId, getToken])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.address_line1.toLowerCase().includes(q) ||
        (r.city ?? '').toLowerCase().includes(q) ||
        (r.state ?? '').toLowerCase().includes(q) ||
        (r.internal_tags ?? []).some((t) => t.toLowerCase().includes(q))
    )
  }, [rows, filter])

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(r.id))

  function toggleAll(checked: boolean) {
    if (checked) setSelected(new Set(filtered.map((r) => r.id)))
    else setSelected(new Set())
  }
  function toggleOne(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  function openAction(a: BulkAction) {
    setAction(a)
    setActionValue('')
    setResultToast(null)
  }

  async function commitAction() {
    if (!action || selected.size === 0) return
    setSubmitting(true)
    try {
      const token = await getToken()
      const res = await fetch('/api/properties/bulk-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          property_ids: Array.from(selected),
          action,
          value: actionValue,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `Bulk edit failed (${res.status})`)
      setResultToast(
        `${body.updated} updated · ${body.unchanged} unchanged · ${body.not_found} missing`
      )
      setAction(null)
      setSelected(new Set())
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AppShell
      breadcrumb={[
        { label: 'Accounts', to: '/accounts' },
        { label: 'Properties admin' },
      ]}
    >
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        <header className="flex items-start justify-between gap-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-fg">Properties</h1>
            <p className="text-sm text-fg-muted">
              Bulk-edit tags and notes across this client's properties.
            </p>
          </div>
          <div className="relative w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-subtle" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter…"
              className="pl-8"
            />
          </div>
        </header>

        {/* Action bar */}
        {selected.size > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-accent/40 bg-accent/5 px-4 py-2.5">
            <p className="text-sm">
              <span className="font-tabular font-medium">{selected.size}</span> selected
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => openAction('add_tag')}>
                <Tag className="h-3.5 w-3.5" />
                Add tag
              </Button>
              <Button size="sm" variant="secondary" onClick={() => openAction('remove_tag')}>
                <Trash2 className="h-3.5 w-3.5" />
                Remove tag
              </Button>
              <Button size="sm" variant="secondary" onClick={() => openAction('set_notes')}>
                <FileText className="h-3.5 w-3.5" />
                Set notes
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          </div>
        )}

        {resultToast && (
          <div className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-xs text-fg">
            {resultToast}
          </div>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}

        {loading ? (
          <p className="text-sm text-fg-muted">Loading…</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No properties match"
            description="Try a different filter."
          />
        ) : (
          <Card padding="none">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={(e) => toggleAll(e.target.checked)}
                      className="rounded border-border accent-accent"
                      aria-label="Select all filtered"
                    />
                  </TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>City / state</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const checked = selected.has(r.id)
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleOne(r.id)}
                          className="rounded border-border accent-accent"
                          aria-label={`Select ${r.address_line1}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Link
                          to={`/properties/${r.id}`}
                          className="text-fg hover:text-accent text-sm"
                        >
                          {r.address_line1}
                        </Link>
                      </TableCell>
                      <TableCell className="text-fg-muted text-xs">
                        {r.city}, {r.state} <span className="font-tabular">{r.postal_code}</span>
                      </TableCell>
                      <TableCell>
                        {r.internal_tags && r.internal_tags.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {r.internal_tags.map((t) => (
                              <Badge key={t} variant="outline">{t}</Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-fg-subtle text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-fg-muted max-w-xs truncate">
                        {r.notes ?? <span className="text-fg-subtle">—</span>}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      <Dialog open={action !== null} onOpenChange={(o) => { if (!o) setAction(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {action === 'add_tag' && 'Add tag to selected'}
              {action === 'remove_tag' && 'Remove tag from selected'}
              {action === 'set_notes' && 'Set notes on selected'}
            </DialogTitle>
            <DialogDescription>
              Will apply to {selected.size} propert{selected.size === 1 ? 'y' : 'ies'}.
              Properties already in the desired state are skipped.
            </DialogDescription>
          </DialogHeader>

          {action === 'set_notes' ? (
            <FormField label="Notes">
              <Textarea
                value={actionValue}
                onChange={(e) => setActionValue(e.target.value)}
                rows={4}
                placeholder="Leave blank to clear notes"
              />
            </FormField>
          ) : (
            <FormField label="Tag" helper="Alphanumeric + dashes, max 50 chars.">
              <Input
                value={actionValue}
                onChange={(e) => setActionValue(e.target.value)}
                placeholder="e.g. high-priority"
                autoFocus
              />
            </FormField>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAction(null)}>Cancel</Button>
            <Button
              onClick={commitAction}
              loading={submitting}
              disabled={action !== 'set_notes' && actionValue.trim().length === 0}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}
