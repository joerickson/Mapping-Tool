import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import AppShell from '../../components/layout/AppShell'
import Button from '../../components/ui/Button'
import { useClient } from '../../context/ClientContext'
import type { Client } from '../../types'

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  prospect: 'bg-yellow-100 text-yellow-700',
  churned: 'bg-gray-100 text-gray-500',
}

interface ClientDetail extends Client {
  account?: { id: string; name: string; display_name?: string | null; account_type: string } | null
  is_configured?: boolean
  stats: { service_location_count: number; portfolio_count: number; total_serviceable_sqft: number }
  recent_uploads: { upload_batch_id: string; filename: string; created_at: string; status: string; row_count: number }[]
}

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { getToken } = useAuth()
  const navigate = useNavigate()
  const { reloadClients } = useClient()

  const [client, setClient] = useState<ClientDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Edit form state
  const [editName, setEditName] = useState('')
  const [editDisplayName, setEditDisplayName] = useState('')
  const [editStatus, setEditStatus] = useState<'active' | 'prospect' | 'churned'>('active')
  const [editContactName, setEditContactName] = useState('')
  const [editContactEmail, setEditContactEmail] = useState('')
  const [editContactPhone, setEditContactPhone] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editBrandColor, setEditBrandColor] = useState('')

  async function loadClient() {
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
    } catch {
      setError('Failed to load client')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (id) loadClient() }, [id])

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
      setConfirmArchive(false)
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

  const clientColor = client.brand_color ?? hashColor(client.id)

  return (
    <AppShell breadcrumb={[{ label: 'Clients', to: '/clients' }, { label: client.display_name ?? client.name }]}>
      <div className="mx-auto max-w-4xl px-6 py-10 space-y-6">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
          )}

          {/* Breadcrumb + Header */}
          <div>
            {/* Account breadcrumb */}
            {client.account && client.account.account_type === 'property_manager' && (
              <div className="flex items-center gap-2 text-sm text-gray-400 mb-2">
                <Link to="/accounts" className="hover:text-gray-600">Accounts</Link>
                <span>›</span>
                <Link to={`/accounts/${client.account.id}`} className="hover:text-gray-600">
                  {client.account.display_name ?? client.account.name}
                </Link>
                <span>›</span>
                <span className="text-gray-700 font-medium">{client.display_name ?? client.name}</span>
              </div>
            )}

            {/* Setup banner */}
            {client.is_configured === false && (
              <div className="mb-4 flex items-center justify-between p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-800">This client hasn't been set up yet.</p>
                <Link
                  to={`/clients/${client.id}/setup`}
                  className="text-sm font-medium text-yellow-900 underline hover:no-underline"
                >
                  Configure Client →
                </Link>
              </div>
            )}

            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-lg"
                  style={{ backgroundColor: clientColor }}
                >
                  {(client.display_name ?? client.name).charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-2xl font-bold text-gray-900">{client.display_name ?? client.name}</h1>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[client.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {client.status}
                    </span>
                    {client.is_combined && (
                      <span className="rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                        Combined · {client.member_client_ids?.length ?? 0} members
                      </span>
                    )}
                  </div>
                  {client.display_name && <p className="text-sm text-gray-400">{client.name}</p>}
                </div>
              </div>
              <div className="flex gap-2">
                <Link
                  to={`/map?client_id=${client.id}`}
                  className="px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  View on map
                </Link>
                <Link
                  to={`/clients/${client.id}/setup`}
                  className="px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  Setup
                </Link>
                <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            <StatCard label="Service Locations" value={client.stats.service_location_count.toLocaleString()} />
            <StatCard label="Portfolios" value={client.stats.portfolio_count.toLocaleString()} />
            <StatCard
              label="Total Sqft"
              value={client.stats.total_serviceable_sqft > 0
                ? client.stats.total_serviceable_sqft.toLocaleString()
                : '—'}
            />
          </div>

          {/* Contact info */}
          {(client.primary_contact_name || client.primary_contact_email || client.notes) && (
            <div className="bg-white rounded-xl shadow-sm border p-5">
              <h2 className="font-semibold text-gray-800 mb-3">Contact</h2>
              <dl className="space-y-2 text-sm">
                {client.primary_contact_name && (
                  <div className="flex gap-2">
                    <dt className="text-gray-500 w-24 shrink-0">Name</dt>
                    <dd>{client.primary_contact_name}</dd>
                  </div>
                )}
                {client.primary_contact_email && (
                  <div className="flex gap-2">
                    <dt className="text-gray-500 w-24 shrink-0">Email</dt>
                    <dd><a href={`mailto:${client.primary_contact_email}`} className="text-blue-600 hover:underline">{client.primary_contact_email}</a></dd>
                  </div>
                )}
                {client.primary_contact_phone && (
                  <div className="flex gap-2">
                    <dt className="text-gray-500 w-24 shrink-0">Phone</dt>
                    <dd>{client.primary_contact_phone}</dd>
                  </div>
                )}
                {client.notes && (
                  <div className="flex gap-2">
                    <dt className="text-gray-500 w-24 shrink-0">Notes</dt>
                    <dd className="whitespace-pre-line">{client.notes}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {/* Recent uploads */}
          {client.recent_uploads.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <div className="px-5 py-4 border-b">
                <h2 className="font-semibold text-gray-800">Recent Uploads</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left px-4 py-2 font-medium text-gray-600">File</th>
                    <th className="text-left px-4 py-2 font-medium text-gray-600">Rows</th>
                    <th className="text-left px-4 py-2 font-medium text-gray-600">Status</th>
                    <th className="text-left px-4 py-2 font-medium text-gray-600">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {client.recent_uploads.map((u) => (
                    <tr key={u.upload_batch_id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-xs text-gray-700">{u.filename}</td>
                      <td className="px-4 py-2">{u.row_count.toLocaleString()}</td>
                      <td className="px-4 py-2">
                        <span className={`text-xs font-medium ${u.status === 'completed' ? 'text-green-600' : u.status === 'failed' ? 'text-red-600' : 'text-yellow-600'}`}>
                          {u.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-gray-500">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Danger zone */}
          <div className="bg-white rounded-xl shadow-sm border border-red-200 p-5">
            <h2 className="font-semibold text-red-700 mb-2">Danger Zone</h2>
            <p className="text-sm text-gray-600 mb-4">
              Archiving sets status to "churned" but does not delete any data.
            </p>
            {confirmArchive ? (
              <div className="flex items-center gap-3">
                <p className="text-sm text-gray-700">Are you sure? This will mark the client as churned.</p>
                <Button variant="danger" size="sm" loading={archiving} onClick={handleArchive}>
                  Confirm Archive
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setConfirmArchive(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button variant="danger" size="sm" onClick={() => setConfirmArchive(true)}>
                Archive Client
              </Button>
            )}
          </div>
        </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Edit Client</h2>
              <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
                <input type="text" value={editDisplayName} onChange={(e) => setEditDisplayName(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select value={editStatus} onChange={(e) => setEditStatus(e.target.value as 'active' | 'prospect' | 'churned')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="active">Active</option>
                    <option value="prospect">Prospect</option>
                    <option value="churned">Churned</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Brand Color</label>
                  <div className="flex gap-2">
                    <input type="color" value={editBrandColor || '#3b82f6'} onChange={(e) => setEditBrandColor(e.target.value)} className="w-9 h-9 rounded border border-gray-300 cursor-pointer p-0.5" />
                    <input type="text" value={editBrandColor} onChange={(e) => setEditBrandColor(e.target.value)} placeholder="#3b82f6" className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name</label>
                <input type="text" value={editContactName} onChange={(e) => setEditContactName(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Email</label>
                <input type="email" value={editContactEmail} onChange={(e) => setEditContactEmail(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Phone</label>
                <input type="tel" value={editContactPhone} onChange={(e) => setEditContactPhone(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>
            </div>
            <div className="px-6 py-4 border-t flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
              <Button loading={saving} onClick={handleSave}>Save Changes</Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border p-4">
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-sm text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}

function hashColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
    hash |= 0
  }
  const h = Math.abs(hash) % 360
  return `hsl(${h}, 65%, 50%)`
}
