// Templates manager page —
// /accounts/:accountId/clients/:clientId/admin/constraint-templates
//
// Lists saved constraint templates for one (account, client) tenant.
// Templates are bundles of service-location constraints that can be
// applied to many SLs at once via the Apply dialog.
import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Plus, Pencil, Trash2, Send } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import AppShell from '../../components/layout/AppShell'
import Button from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Card, CardTitle, CardDescription } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import EditTemplateDialog, { type ConstraintTemplate } from '../../components/property/EditTemplateDialog'
import ApplyTemplateDialog from '../../components/property/ApplyTemplateDialog'
import { CONSTRAINT_LABELS, type ConstraintType } from '../../components/property/constraint-types'

interface AccountInfo { id: string; name: string; display_name: string | null }
interface ClientInfo { id: string; name: string; display_name: string | null }

export default function ConstraintTemplatesPage() {
  const { accountId, clientId } = useParams<{ accountId: string; clientId: string }>()
  const { getToken } = useAuth()

  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [client, setClient] = useState<ClientInfo | null>(null)
  const [templates, setTemplates] = useState<ConstraintTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ConstraintTemplate | null>(null)
  const [creating, setCreating] = useState(false)
  const [applying, setApplying] = useState<ConstraintTemplate | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!accountId || !clientId) return
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      const [tplRes, accRes, cliRes] = await Promise.all([
        fetch(`/api/accounts/${accountId}/clients/${clientId}/constraint-templates`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/accounts/${accountId}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/v1/clients/${clientId}`, { headers: { Authorization: `Bearer ${token}` } }),
      ])
      if (!tplRes.ok) throw new Error(`Templates load failed (${tplRes.status})`)
      const tplJson = (await tplRes.json()) as { templates: ConstraintTemplate[] }
      setTemplates(tplJson.templates)
      if (accRes.ok) setAccount((await accRes.json()).account ?? (await accRes.json()))
      if (cliRes.ok) setClient(await cliRes.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [accountId, clientId, getToken])

  useEffect(() => { load() }, [load])

  async function handleDelete(id: string) {
    if (!confirm('Delete this template?')) return
    setDeletingId(id)
    try {
      const token = await getToken()
      const res = await fetch(
        `/api/accounts/${accountId}/clients/${clientId}/constraint-templates/${id}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Delete failed (${res.status})`)
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <AppShell
      breadcrumb={[
        { label: 'Accounts', to: '/accounts' },
        { label: account?.display_name ?? account?.name ?? '…', to: `/accounts/${accountId}` },
        { label: client?.display_name ?? client?.name ?? '…' },
        { label: 'Constraint templates' },
      ]}
    >
      <div className="mx-auto max-w-5xl px-6 py-10 space-y-8">
        <header className="flex items-start justify-between gap-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-fg">Constraint templates</h1>
            <p className="text-sm text-fg-muted">
              Saved bundles of service-location constraints. Apply a template to many service locations at once.
            </p>
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New template
          </Button>
        </header>

        {error && (
          <p className="text-sm text-danger">Error: {error}</p>
        )}

        {loading ? (
          <p className="text-sm text-fg-muted">Loading templates…</p>
        ) : templates.length === 0 ? (
          <EmptyState
            title="No templates yet"
            description="Create a template to bundle common constraints (e.g. M–F 8a–6p + badge access) and apply them to many service locations in one click."
            action={
              <Button variant="secondary" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                Create your first template
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {templates.map((t) => (
              <Card key={t.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0 flex-1">
                    <CardTitle>{t.name}</CardTitle>
                    {t.description && <CardDescription>{t.description}</CardDescription>}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1">
                  {t.constraints.map((c, i) => (
                    <Badge key={i} variant={c.enforcement === 'hard' ? 'accent' : 'outline'}>
                      {CONSTRAINT_LABELS[c.constraint_type as ConstraintType] ?? c.constraint_type}
                    </Badge>
                  ))}
                </div>

                <div className="mt-4 flex items-center gap-2 flex-wrap">
                  <Button size="sm" onClick={() => setApplying(t)}>
                    <Send className="h-3.5 w-3.5" />
                    Apply to properties
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(t)}>
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(t.id)}
                    loading={deletingId === t.id}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <EditTemplateDialog
        open={creating || editing !== null}
        onClose={() => { setCreating(false); setEditing(null) }}
        accountId={accountId!}
        clientId={clientId!}
        template={editing}
        onSaved={() => { setCreating(false); setEditing(null); load() }}
      />

      <ApplyTemplateDialog
        open={applying !== null}
        onClose={() => setApplying(null)}
        accountId={accountId!}
        clientId={clientId!}
        template={applying}
        onApplied={() => setApplying(null)}
      />
    </AppShell>
  )
}
