import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import Navbar from '../../components/ui/Navbar'
import Button from '../../components/ui/Button'
import type { Account, Client } from '../../types'

const TYPE_BADGE: Record<string, string> = {
  self_managed: 'bg-blue-100 text-blue-700',
  property_manager: 'bg-purple-100 text-purple-700',
}
const TYPE_LABEL: Record<string, string> = {
  self_managed: 'Self-Managed',
  property_manager: 'Property Manager',
}

interface AccountDetail extends Account {
  stats: { client_count: number; service_location_count: number }
  recent_uploads: { upload_batch_id: string; filename: string; status: string; row_count: number; created_at: string }[]
}

export default function AccountDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { getToken } = useAuth()
  const navigate = useNavigate()

  const [account, setAccount] = useState<AccountDetail | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [editName, setEditName] = useState('')
  const [editDisplayName, setEditDisplayName] = useState('')
  const [editStatus, setEditStatus] = useState('active')
  const [editContactName, setEditContactName] = useState('')
  const [editContactEmail, setEditContactEmail] = useState('')
  const [editContactPhone, setEditContactPhone] = useState('')
  const [editNotes, setEditNotes] = useState('')

  async function loadAccount() {
    setLoading(true)
    try {
      const token = await getToken()
      const [accRes, clientsRes] = await Promise.all([
        fetch(`/api/v1/accounts/${id}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/v1/clients?account_id=${id}`, { headers: { Authorization: `Bearer ${token}` } }),
      ])
      if (!accRes.ok) throw new Error('Account not found')
      const data: AccountDetail = await accRes.json()
      const clientData: Client[] = clientsRes.ok ? await clientsRes.json() : []
      setAccount(data)
      setClients(clientData)
      setEditName(data.name)
      setEditDisplayName(data.display_name ?? '')
      setEditStatus(data.status)
      setEditContactName(data.primary_contact_name ?? '')
      setEditContactEmail(data.primary_contact_email ?? '')
      setEditContactPhone(data.primary_contact_phone ?? '')
      setEditNotes(data.notes ?? '')
    } catch {
      setError('Failed to load account')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (id) loadAccount() }, [id])

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/accounts/${id}`, {
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
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed')
      await loadAccount()
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="flex flex-col h-full bg-gray-50"><Navbar />
      <div className="flex-1 flex items-center justify-center text-gray-400">Loading…</div>
    </div>
  )

  if (!account) return (
    <div className="flex flex-col h-full bg-gray-50"><Navbar />
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-gray-500">Account not found.</p>
          <Link to="/accounts" className="text-blue-600 text-sm hover:underline">← Back to accounts</Link>
        </div>
      </div>
    </div>
  )

  const isPM = account.account_type === 'property_manager'
  const selfClient = !isPM ? clients[0] : null

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <Navbar />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Link to="/accounts" className="text-gray-400 hover:text-gray-600 text-sm">Accounts</Link>
                <span className="text-gray-300">›</span>
                <h1 className="text-2xl font-bold text-gray-900">{account.display_name ?? account.name}</h1>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_BADGE[account.account_type]}`}>
                  {TYPE_LABEL[account.account_type]}
                </span>
              </div>
              {account.display_name && <p className="text-sm text-gray-400">{account.name}</p>}
            </div>
            <div className="flex items-center gap-2">
              <Link
                to={`/accounts/${id}/analysis`}
                className="px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Smart Analysis →
              </Link>
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Edit</Button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-4">
            <StatCard label={isPM ? 'Clients' : 'Service Locations'} value={isPM ? String(account.stats.client_count) : String(account.stats.service_location_count)} />
            <StatCard label="Service Locations" value={String(account.stats.service_location_count)} />
          </div>

          {/* Self-managed: single-client view */}
          {!isPM && selfClient && (
            <div className="bg-white rounded-xl shadow-sm border p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-800">Client</h2>
                <Link to={`/clients/${selfClient.id}`} className="text-sm text-blue-600 hover:underline">View →</Link>
              </div>
              <p className="text-sm text-gray-700 font-medium">{selfClient.display_name ?? selfClient.name}</p>
              <ClientSetupBanner client={selfClient} />
            </div>
          )}

          {/* Property manager: clients list */}
          {isPM && (
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <div className="px-5 py-4 border-b flex items-center justify-between">
                <h2 className="font-semibold text-gray-800">Clients</h2>
                <Link
                  to={`/accounts/${id}/clients/new`}
                  className="px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  + Add Client
                </Link>
              </div>
              {clients.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <p className="text-gray-500 text-sm">No clients yet.</p>
                  <Link
                    to={`/accounts/${id}/clients/new`}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
                  >
                    Add your first client →
                  </Link>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Contact</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {clients.map((c) => (
                      <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <Link to={`/clients/${c.id}`} className="font-medium text-gray-900 hover:text-blue-600">
                            {c.display_name ?? c.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                            {c.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{c.primary_contact_name ?? '—'}</td>
                        <td className="px-4 py-3 flex gap-2">
                          <Link to={`/clients/${c.id}`} className="text-blue-600 hover:underline text-xs">View</Link>
                          <Link to={`/clients/${c.id}/setup`} className="text-gray-500 hover:underline text-xs">Setup</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Recent uploads */}
          {account.recent_uploads.length > 0 && (
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
                  {account.recent_uploads.map((u) => (
                    <tr key={u.upload_batch_id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-xs">{u.filename}</td>
                      <td className="px-4 py-2">{u.row_count.toLocaleString()}</td>
                      <td className="px-4 py-2">
                        <span className={`text-xs font-medium ${u.status === 'completed' ? 'text-green-600' : u.status === 'failed' ? 'text-red-600' : 'text-yellow-600'}`}>{u.status}</span>
                      </td>
                      <td className="px-4 py-2 text-gray-500">{new Date(u.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Edit Account</h2>
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
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
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
    </div>
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

function ClientSetupBanner({ client }: { client: Client }) {
  return (
    <div className="mt-2">
      <Link to={`/clients/${client.id}/setup`} className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
        Configure client setup →
      </Link>
    </div>
  )
}
