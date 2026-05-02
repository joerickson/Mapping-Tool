import { useState, useEffect, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowRight, MapPin, Pencil, Settings, Trash2 } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import AppShell from '../../components/layout/AppShell'
import Button from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Card, CardTitle } from '../../components/ui/Card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../components/ui/Table'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '../../components/ui/Dialog'
import { Input, Textarea, FormField } from '../../components/ui/Input'
import { useClient } from '../../context/ClientContext'
import type { Client } from '../../types'

interface ClientDetail extends Client {
  account?: { id: string; name: string; display_name?: string | null; account_type: string } | null
  is_configured?: boolean
  recent_uploads: { upload_batch_id: string; filename: string; created_at: string; status: string; row_count: number }[]
}

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { getToken } = useAuth()
  const navigate = useNavigate()
  const { reloadClients } = useClient()

  const [client, setClient] = useState<ClientDetail | null>(null)
  const [members, setMembers] = useState<Array<{ id: string; name: string; display_name: string | null; account_id: string }> | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [editName, setEditName] = useState('')
  const [editDisplayName, setEditDisplayName] = useState('')
  const [editStatus, setEditStatus] = useState<'active' | 'prospect' | 'churned'>('active')
  const [editContactName, setEditContactName] = useState('')
  const [editContactEmail, setEditContactEmail] = useState('')
  const [editContactPhone, setEditContactPhone] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editBrandColor, setEditBrandColor] = useState('')

  const loadClient = useCallback(async () => {
    setLoading(true)
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/clients/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Client not found')
      const data: ClientDetail = await res.json()
      setClient(data)
      setEditName(data.name)
      setEditDisplayName(data.display_name ?? '')
      setEditStatus(data.status)
      setEditContactName(data.primary_contact_name ?? '')
      setEditContactEmail(data.primary_contact_email ?? '')
      setEditContactPhone(data.primary_contact_phone ?? '')
      setEditNotes(data.notes ?? '')
      setEditBrandColor(data.brand_color ?? '')

      if (data.is_combined && Array.isArray(data.member_client_ids) && data.member_client_ids.length > 0) {
        const memRes = await fetch(`/api/v1/clients`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (memRes.ok) {
          const all = (await memRes.json()) as Array<{ id: string; name: string; display_name: string | null; account_id: string }>
          const idSet = new Set(data.member_client_ids)
          setMembers(all.filter((c) => idSet.has(c.id)))
        }
      } else {
        setMembers(null)
      }
    } catch {
      setError('Failed to load client')
    } finally {
      setLoading(false)
    }
  }, [id, getToken])

  useEffect(() => { if (id) loadClient() }, [id, loadClient])

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/clients/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: editName.trim(),
          display_name: editDisplayName.trim() || null,
          status: editStatus,
          primary_contact_name: editContactName.trim() || null,
          primary_contact_email: editContactEmail.trim() || null,
          primary_contact_phone: editContactPhone.trim() || null,
          notes: editNotes.trim() || null,
          brand_color: editBrandColor || null,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed')
      await loadClient()
      await reloadClients()
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleArchive() {
    setArchiving(true)
    try {
      const token = await getToken()
      await fetch(`/api/v1/clients/${id}/archive`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      await reloadClients()
      navigate('/clients')
    } catch {
      setError('Archive failed')
    } finally {
      setArchiving(false)
      setConfirmArchiveOpen(false)
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center text-fg-subtle">Loading…</div>
      </AppShell>
    )
  }
  if (!client) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center">
          <div className="space-y-3 text-center">
            <p className="text-fg-muted">Client not found.</p>
            <Link to="/clients" className="text-sm text-accent hover:underline">← Back to clients</Link>
          </div>
        </div>
      </AppShell>
    )
  }

  const breadcrumb = client.account
    ? [
        { label: 'Accounts', to: '/accounts' },
        { label: client.account.display_name ?? client.account.name, to: `/accounts/${client.account.id}` },
        { label: client.display_name ?? client.name },
      ]
    : [
        { label: 'Clients', to: '/clients' },
        { label: client.display_name ?? client.name },
      ]

  const analysisHref = client.account
    ? `/accounts/${client.account.id}/clients/${client.id}/analysis`
    : null

  return (
    <AppShell breadcrumb={breadcrumb}>
      <div className="mx-auto max-w-4xl px-6 py-10 space-y-6">
        {error && (
          <p className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        {/* Setup banner — only when not configured */}
        {client.is_configured === false && (
          <div className="flex items-center justify-between rounded-md border border-warning/30 bg-warning-subtle px-3 py-2">
            <p className="text-sm text-warning-fg">This client hasn't been set up yet.</p>
            <Link
              to={`/clients/${client.id}/setup`}
              className="text-sm font-medium text-warning-fg hover:underline"
            >
              Configure client →
            </Link>
          </div>
        )}

        {/* Header */}
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold tracking-tight text-fg">
                {client.display_name ?? client.name}
              </h1>
              <Badge variant={client.status === 'active' ? 'success' : client.status === 'prospect' ? 'warning' : 'outline'}>
                {client.status}
              </Badge>
              {client.is_combined && (
                <Badge variant="accent">
                  Combined · {client.member_client_ids?.length ?? 0} members
                </Badge>
              )}
            </div>
            {client.display_name && client.display_name !== client.name && (
              <p className="text-sm text-fg-subtle">{client.name}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link to={`/map?client_id=${client.id}`}>
                <MapPin className="h-3.5 w-3.5" />
                Map
              </Link>
            </Button>
            {!client.is_combined && (
              <Button variant="ghost" asChild>
                <Link to={`/clients/${client.id}/setup`}>
                  <Settings className="h-3.5 w-3.5" />
                  Setup
                </Link>
              </Button>
            )}
            <Button onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          </div>
        </header>

        {/* Primary CTA — get the user to the Smart Analysis page where they actually do work */}
        {analysisHref && (
          <Card className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <CardTitle>Smart Analysis</CardTitle>
              <p className="text-sm text-fg-muted">
                {client.is_combined
                  ? 'Run portfolio-wide analysis across this combined client. Branch Optimization, Crew Strategy, scheduler — all see the unioned property pool.'
                  : 'Run analysis modules, view branch selection, and configure constraints.'}
              </p>
            </div>
            <Button asChild>
              <Link to={analysisHref}>
                Open analysis
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </Card>
        )}

        {/* Combined-client member list */}
        {client.is_combined && members && members.length > 0 && (
          <Card padding="none">
            <div className="px-4 py-3 border-b border-border">
              <CardTitle>Member clients ({members.length})</CardTitle>
              <p className="text-xs text-fg-subtle mt-0.5">
                These clients' service locations and offerings are unioned into this combined
                view. Members remain fully usable on their own.
              </p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <Link to={`/clients/${m.id}`} className="text-accent hover:underline font-medium">
                        {m.display_name ?? m.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        to={`/accounts/${m.account_id}/clients/${m.id}/analysis`}
                        className="text-xs text-fg-muted hover:text-accent"
                      >
                        Analysis →
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}

        {/* Contact info */}
        {(client.primary_contact_name || client.primary_contact_email || client.primary_contact_phone || client.notes) && (
          <Card className="space-y-3">
            <CardTitle>Contact</CardTitle>
            <dl className="space-y-2 text-sm">
              {client.primary_contact_name && (
                <Row label="Name" value={client.primary_contact_name} />
              )}
              {client.primary_contact_email && (
                <Row
                  label="Email"
                  value={
                    <a href={`mailto:${client.primary_contact_email}`} className="text-accent hover:underline">
                      {client.primary_contact_email}
                    </a>
                  }
                />
              )}
              {client.primary_contact_phone && (
                <Row label="Phone" value={client.primary_contact_phone} />
              )}
              {client.notes && (
                <Row label="Notes" value={<span className="whitespace-pre-line">{client.notes}</span>} />
              )}
            </dl>
          </Card>
        )}

        {/* Recent uploads */}
        {client.recent_uploads.length > 0 && (
          <Card padding="none">
            <div className="px-4 py-3 border-b border-border">
              <CardTitle>Recent uploads</CardTitle>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {client.recent_uploads.map((u) => (
                  <TableRow key={u.upload_batch_id}>
                    <TableCell className="font-mono text-xs">{u.filename}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {u.row_count.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          u.status === 'completed' ? 'success'
                            : u.status === 'failed' ? 'danger'
                            : 'warning'
                        }
                      >
                        {u.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-fg-muted text-xs">
                      {new Date(u.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}

        {/* Danger zone */}
        <Card className="border-danger/30 space-y-2">
          <CardTitle className="text-danger">Danger zone</CardTitle>
          <p className="text-sm text-fg-muted">
            Archiving sets the client status to "churned". No data is deleted.
          </p>
          <div>
            <Button variant="danger" size="sm" onClick={() => setConfirmArchiveOpen(true)}>
              <Trash2 className="h-3.5 w-3.5" />
              Archive client
            </Button>
          </div>
        </Card>
      </div>

      {/* Edit modal */}
      <Dialog open={editing} onOpenChange={(o) => !o && setEditing(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit client</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {error && (
              <p className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}
            <FormField label="Name">
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </FormField>
            <FormField label="Display name">
              <Input value={editDisplayName} onChange={(e) => setEditDisplayName(e.target.value)} />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Status">
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as 'active' | 'prospect' | 'churned')}
                  className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg focus:border-accent focus:outline-none"
                >
                  <option value="active">Active</option>
                  <option value="prospect">Prospect</option>
                  <option value="churned">Churned</option>
                </select>
              </FormField>
              <FormField label="Brand color">
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={editBrandColor || '#3b82f6'}
                    onChange={(e) => setEditBrandColor(e.target.value)}
                    className="h-9 w-9 rounded-md border border-border p-0.5"
                  />
                  <Input
                    value={editBrandColor}
                    onChange={(e) => setEditBrandColor(e.target.value)}
                    placeholder="#3b82f6"
                    className="font-mono"
                  />
                </div>
              </FormField>
            </div>
            <FormField label="Contact name">
              <Input value={editContactName} onChange={(e) => setEditContactName(e.target.value)} />
            </FormField>
            <FormField label="Contact email">
              <Input
                type="email"
                value={editContactEmail}
                onChange={(e) => setEditContactEmail(e.target.value)}
              />
            </FormField>
            <FormField label="Contact phone">
              <Input
                type="tel"
                value={editContactPhone}
                onChange={(e) => setEditContactPhone(e.target.value)}
              />
            </FormField>
            <FormField label="Notes">
              <Textarea
                rows={3}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
              />
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} loading={saving}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive confirmation */}
      <Dialog open={confirmArchiveOpen} onOpenChange={(o) => !o && setConfirmArchiveOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive client?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-fg-muted">
            This sets the client status to "churned". No data is deleted; you can reactivate
            from the Edit dialog later.
          </p>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmArchiveOpen(false)}
              disabled={archiving}
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={handleArchive} loading={archiving}>
              Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="text-fg-muted w-24 shrink-0">{label}</dt>
      <dd className="text-fg">{value}</dd>
    </div>
  )
}
