// Per-client custom-field manager. Operators define field_key + label +
// type + (for select) options; toggle which appear in the Map filter
// sidebar; archive what they no longer need. Backed by the existing
// /api/v1/custom-field-definitions CRUD.
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import AppShell from '../../components/layout/AppShell'
import { Card, CardTitle, CardDescription } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import { Input, FormField, Textarea } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/Table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/Dialog'
import { useAuth } from '../../hooks/useAuth'

type FieldType = 'text' | 'number' | 'date' | 'select'

interface FieldDef {
  id: string
  field_key: string
  field_label: string
  field_type: FieldType
  select_options: string[] | null
  account_id: string | null
  client_id: string | null
  appears_in_filters: boolean
  appears_in_groups: boolean
  sort_order: number
}

export default function CustomFieldsAdminPage() {
  const { accountId, clientId } = useParams<{ accountId: string; clientId: string }>()
  const { getToken } = useAuth()
  const [fields, setFields] = useState<FieldDef[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [account, setAccount] = useState<{ name: string; display_name: string | null } | null>(null)
  const [client, setClient] = useState<{ name: string; display_name: string | null } | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<FieldDef | null>(null)

  const refresh = useCallback(async () => {
    if (!clientId || !accountId) return
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      const [defsRes, accRes, cliRes] = await Promise.all([
        fetch(`/api/v1/custom-field-definitions?client_id=${clientId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/accounts/${accountId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/v1/clients/${clientId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ])
      if (!defsRes.ok) throw new Error(`HTTP ${defsRes.status}`)
      const defs = (await defsRes.json()) as FieldDef[]
      setFields(defs)
      if (accRes.ok) {
        const j = await accRes.json()
        setAccount(j.account ?? j)
      }
      if (cliRes.ok) setClient(await cliRes.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [accountId, clientId, getToken])

  useEffect(() => {
    refresh()
  }, [refresh])

  const remove = async (id: string) => {
    if (!confirm('Delete this field? Existing data on properties is preserved but the field will no longer appear in filters.')) return
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/custom-field-definitions/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as any).error ?? `HTTP ${res.status}`)
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const toggleFilter = async (f: FieldDef) => {
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/custom-field-definitions/${f.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ appears_in_filters: !f.appears_in_filters }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <AppShell
      breadcrumb={[
        { label: 'Accounts', to: '/accounts' },
        { label: account?.display_name ?? account?.name ?? '…', to: `/accounts/${accountId}` },
        { label: client?.display_name ?? client?.name ?? '…' },
      ]}
    >
      <div className="space-y-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold text-fg">Custom fields</h1>
            <p className="text-xs text-fg-muted mt-0.5">
              Fields you imported via spreadsheet that you want to filter or group by. Per-client.
            </p>
          </div>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New field
          </Button>
        </div>

        {error && (
          <Card padding="md">
            <p className="text-sm text-danger">{error}</p>
          </Card>
        )}

        {loading ? (
          <Card padding="md">
            <p className="text-sm text-fg-muted">Loading…</p>
          </Card>
        ) : fields.length === 0 ? (
          <Card padding="md">
            <CardTitle>No custom fields yet</CardTitle>
            <CardDescription>
              When you import a spreadsheet, any column you don't map to a
              standard field becomes a custom field stored on each service
              location. Define the field here so it shows up as a filter on
              the Map page.
            </CardDescription>
          </Card>
        ) : (
          <Card padding="none">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Options</TableHead>
                  <TableHead className="text-right">In filters?</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => setEditing(f)}
                        className="font-medium text-accent hover:underline"
                      >
                        {f.field_label}
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-fg-muted">{f.field_key}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {f.field_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-fg-muted truncate max-w-xs">
                      {f.field_type === 'select'
                        ? (f.select_options ?? []).join(', ') || '—'
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <button
                        type="button"
                        onClick={() => toggleFilter(f)}
                        className={
                          'rounded-md border px-2 py-0.5 text-xs ' +
                          (f.appears_in_filters
                            ? 'border-accent bg-accent/10 text-accent'
                            : 'border-border bg-surface text-fg-muted hover:text-fg')
                        }
                      >
                        {f.appears_in_filters ? 'Yes' : 'No'}
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      <button
                        type="button"
                        onClick={() => remove(f.id)}
                        className="text-fg-subtle hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      {(creating || editing) && (
        <FieldDialog
          accountId={accountId!}
          clientId={clientId!}
          existing={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={() => {
            setCreating(false)
            setEditing(null)
            refresh()
          }}
        />
      )}
    </AppShell>
  )
}

function FieldDialog({
  accountId,
  clientId,
  existing,
  onClose,
  onSaved,
}: {
  accountId: string
  clientId: string
  existing: FieldDef | null
  onClose: () => void
  onSaved: () => void
}) {
  const { getToken } = useAuth()
  const [label, setLabel] = useState(existing?.field_label ?? '')
  const [key, setKey] = useState(existing?.field_key ?? '')
  const [type, setType] = useState<FieldType>(existing?.field_type ?? 'text')
  const [optionsText, setOptionsText] = useState(
    (existing?.select_options ?? []).join('\n')
  )
  const [appearsInFilters, setAppearsInFilters] = useState(
    existing?.appears_in_filters ?? true
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const isEdit = !!existing

  const save = async () => {
    setErr(null)
    if (!label.trim()) {
      setErr('Label is required')
      return
    }
    if (!isEdit && !key.trim()) {
      setErr('Key is required')
      return
    }
    if (type === 'select') {
      const opts = optionsText.split('\n').map((s) => s.trim()).filter(Boolean)
      if (opts.length === 0) {
        setErr('Select fields need at least one option (one per line)')
        return
      }
    }
    setSaving(true)
    try {
      const token = await getToken()
      const select_options =
        type === 'select'
          ? optionsText.split('\n').map((s) => s.trim()).filter(Boolean)
          : null
      if (isEdit) {
        const res = await fetch(
          `/api/v1/custom-field-definitions/${existing!.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              field_label: label.trim(),
              select_options,
              appears_in_filters: appearsInFilters,
            }),
          }
        )
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error((j as any).error ?? `HTTP ${res.status}`)
        }
      } else {
        const res = await fetch(`/api/v1/custom-field-definitions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            field_key: key.trim(),
            field_label: label.trim(),
            field_type: type,
            select_options,
            account_id: accountId,
            client_id: clientId,
            appears_in_filters: appearsInFilters,
          }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error((j as any).error ?? `HTTP ${res.status}`)
        }
      }
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit field' : 'New custom field'}</DialogTitle>
          <DialogDescription>
            Define a field that exists on this client's service locations
            (typically imported from a spreadsheet column).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <FormField label="Label" helper="What operators see in the filter sidebar.">
            <Input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Region, Tier, Inspector"
            />
          </FormField>
          <FormField
            label="Key"
            helper={
              isEdit
                ? 'Cannot change after creation — must match the property data.'
                : 'Internal key matching the column name on imported rows. Lowercase, no spaces.'
            }
          >
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
              placeholder="e.g. region, tier, inspector"
              disabled={isEdit}
            />
          </FormField>
          <FormField label="Type">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as FieldType)}
              className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg"
              disabled={isEdit}
            >
              <option value="text">Text (contains-match)</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
              <option value="select">Select (multi-choice)</option>
            </select>
          </FormField>
          {type === 'select' && (
            <FormField
              label="Options"
              helper="One per line. These show as checkboxes in the filter sidebar."
            >
              <Textarea
                rows={4}
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                placeholder={'North\nSouth\nEast\nWest'}
              />
            </FormField>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={appearsInFilters}
              onChange={(e) => setAppearsInFilters(e.target.checked)}
              className="rounded border-border accent-accent"
            />
            Show in Map filter sidebar
          </label>
        </div>

        {err && (
          <p className="text-xs text-danger border border-danger/30 bg-danger-subtle rounded-md px-2 py-1">
            {err}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            {isEdit ? 'Save changes' : 'Create field'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
