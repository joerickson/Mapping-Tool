import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Building2, Home, Settings, Users } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import Button from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import AppShell from '../../components/layout/AppShell'
import {
  Sidebar,
  SidebarItem,
  SidebarSection,
} from '../../components/layout/Sidebar'
import type { Account, Client } from '../../types'

// Phase 3.6 — Account Overview shape returned by /api/accounts/[id]/overview
interface OverviewClient {
  id: string
  name: string
  display_name: string | null
  status: string
  property_count: number
  service_location_count: number
  states_count: number
  last_analysis_at: string | null
  last_synthesis_at: string | null
  synthesis_status: 'fresh' | 'stale' | 'never'
  branch_selection: {
    selected_k: number | null
    selected_branches: Array<{ city_state: string }> | null
  }
}
interface AccountOverview {
  client_count: number
  total_properties: number
  total_service_locations: number
  unique_states: number
  last_activity_at: string | null
  clients: OverviewClient[]
}

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
  const [overview, setOverview] = useState<AccountOverview | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const fromLegacyAnalysis = searchParams.get('from') === 'legacy-analysis'
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
      const [accRes, clientsRes, overviewRes] = await Promise.all([
        fetch(`/api/v1/accounts/${id}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/v1/clients?account_id=${id}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/accounts/${id}/overview`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
      ])
      if (!accRes.ok) throw new Error('Account not found')
      const data: AccountDetail = await accRes.json()
      const clientData: Client[] = clientsRes.ok ? await clientsRes.json() : []
      const overviewData: AccountOverview | null =
        overviewRes && overviewRes.ok ? await overviewRes.json() : null
      setAccount(data)
      setClients(clientData)
      setOverview(overviewData)
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
    <AppShell breadcrumb={[{ label: 'Accounts', to: '/accounts' }, { label: 'Loading…' }]}>
      <div className="flex h-full items-center justify-center text-fg-subtle">
        Loading…
      </div>
    </AppShell>
  )

  if (!account) return (
    <AppShell breadcrumb={[{ label: 'Accounts', to: '/accounts' }, { label: 'Not found' }]}>
      <div className="flex h-full items-center justify-center">
        <div className="space-y-3 text-center">
          <p className="text-fg-muted">Account not found.</p>
          <Link to="/accounts" className="text-sm text-accent hover:underline">
            ← Back to accounts
          </Link>
        </div>
      </div>
    </AppShell>
  )

  const isPM = account.account_type === 'property_manager'
  const selfClient = !isPM ? clients[0] : null

  return (
    <AppShell
      breadcrumb={[
        { label: 'Accounts', to: '/accounts' },
        { label: account.display_name ?? account.name },
      ]}
      sidebar={
        <AccountOverviewSidebar
          accountId={id!}
          accountName={account.display_name ?? account.name}
          clients={overview?.clients ?? clients.map(toOverviewLite)}
          isPropertyManager={isPM}
        />
      }
    >
      <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        {error && (
          <div className="p-3 bg-danger-subtle border border-danger/20 rounded-md text-danger text-sm">
            {error}
          </div>
        )}

        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-fg">
                {account.display_name ?? account.name}
              </h1>
              <Badge variant={isPM ? 'accent' : 'default'}>
                {TYPE_LABEL[account.account_type]}
              </Badge>
            </div>
            {account.display_name && (
              <p className="text-sm text-fg-subtle">{account.name}</p>
            )}
          </div>
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>

          {/* Phase 3.6 — banner when bounced from old /analysis URL */}
          {fromLegacyAnalysis && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm flex items-start justify-between gap-3">
              <div>
                Smart Analysis is now per-client. Pick a client below to continue.
              </div>
              <button
                onClick={() => { searchParams.delete('from'); setSearchParams(searchParams, { replace: true }) }}
                className="text-amber-600 hover:text-amber-800 text-xs"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Aggregate stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Clients"
              value={String(overview?.client_count ?? account.stats.client_count)}
            />
            <StatCard
              label="Properties"
              value={String(overview?.total_properties ?? '—')}
            />
            <StatCard
              label="Service Locations"
              value={String(overview?.total_service_locations ?? account.stats.service_location_count)}
            />
            <StatCard
              label="States"
              value={String(overview?.unique_states ?? '—')}
            />
          </div>

          {/* Clients (analysis overview) — Phase 3.6: per-client cards with
              analysis status + View/Start Analysis buttons. */}
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">Clients</h2>
              {isPM && (
                <Link
                  to={`/accounts/${id}/clients/new`}
                  className="px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  + Add Client
                </Link>
              )}
            </div>
            {(overview?.clients ?? clients.map((c) => ({
              id: c.id,
              name: c.name,
              display_name: c.display_name,
              status: c.status,
              property_count: 0,
              service_location_count: 0,
              states_count: 0,
              last_analysis_at: null as string | null,
              last_synthesis_at: null as string | null,
              synthesis_status: 'never' as const,
              branch_selection: { selected_k: null, selected_branches: null },
            }))).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <p className="text-gray-500 text-sm">No clients yet.</p>
                {isPM && (
                  <Link
                    to={`/accounts/${id}/clients/new`}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
                  >
                    Add your first client →
                  </Link>
                )}
              </div>
            ) : (
              <ul className="divide-y">
                {(overview?.clients ?? []).map((c) => (
                  <ClientOverviewRow key={c.id} accountId={id!} client={c} />
                ))}
                {!overview && clients.map((c) => (
                  // Fallback before /overview returns: lighter row that still
                  // exposes the View Analysis link.
                  <li key={c.id} className="px-5 py-4 flex items-center justify-between gap-4">
                    <div>
                      <Link to={`/clients/${c.id}`} className="font-medium text-gray-900 hover:text-blue-600">
                        {c.display_name ?? c.name}
                      </Link>
                      <p className="text-xs text-gray-400 mt-0.5">Loading analysis status…</p>
                    </div>
                    <Link
                      to={`/accounts/${id}/clients/${c.id}/analysis`}
                      className="px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      View Analysis →
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Self-managed: surface client setup banner */}
          {!isPM && selfClient && <ClientSetupBanner client={selfClient} />}

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

// Sidebar shown next to the Account Overview page. Lives in this file
// because the data shape is page-specific; if it grows, factor out.
function AccountOverviewSidebar({
  accountId,
  accountName,
  clients,
  isPropertyManager,
}: {
  accountId: string
  accountName: string
  clients: Pick<OverviewClient, 'id' | 'name' | 'display_name' | 'property_count'>[]
  isPropertyManager: boolean
}) {
  return (
    <Sidebar>
      <SidebarSection title="Account">
        <SidebarItem icon={Home} to={`/accounts/${accountId}`} active>
          Overview
        </SidebarItem>
        <SidebarItem icon={Settings} disabled>
          Settings
        </SidebarItem>
        <SidebarItem icon={Users} disabled>
          Team
        </SidebarItem>
      </SidebarSection>

      <SidebarSection title={`Clients · ${accountName}`}>
        {clients.length === 0 ? (
          <li className="px-2 py-1 text-xs text-fg-subtle">
            No clients on this account.
          </li>
        ) : (
          clients.map((c) => (
            <SidebarItem
              key={c.id}
              icon={Building2}
              to={`/accounts/${accountId}/clients/${c.id}/analysis`}
              trailing={
                c.property_count > 0 ? (
                  <Badge variant="default">{c.property_count}</Badge>
                ) : null
              }
            >
              {c.display_name ?? c.name}
            </SidebarItem>
          ))
        )}
        {isPropertyManager && (
          <SidebarItem
            icon={Users}
            to={`/accounts/${accountId}/clients/new`}
            className="text-fg-subtle"
          >
            + Add client
          </SidebarItem>
        )}
      </SidebarSection>
    </Sidebar>
  )
}

// Adapter so the sidebar can render before /overview returns by falling
// back to the bare clients list. property_count = 0 hides the badge.
function toOverviewLite(c: Client): Pick<
  OverviewClient,
  'id' | 'name' | 'display_name' | 'property_count'
> {
  return {
    id: c.id,
    name: c.name,
    display_name: c.display_name ?? null,
    property_count: 0,
  }
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

function ClientOverviewRow({
  accountId,
  client,
}: {
  accountId: string
  client: OverviewClient
}) {
  const synthBadge = (() => {
    switch (client.synthesis_status) {
      case 'fresh':
        return <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-xs">Synthesis fresh</span>
      case 'stale':
        return <span className="px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 text-xs">Synthesis stale</span>
      default:
        return null
    }
  })()
  const lastRun = client.last_analysis_at ? relativeTime(client.last_analysis_at) : null
  const hasAnalysis = !!client.last_analysis_at
  return (
    <li className="px-5 py-4 flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link to={`/clients/${client.id}`} className="font-medium text-gray-900 hover:text-blue-600">
            {client.display_name ?? client.name}
          </Link>
          {synthBadge}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">
          {client.property_count} {client.property_count === 1 ? 'property' : 'properties'}
          {' · '}
          {client.states_count} {client.states_count === 1 ? 'state' : 'states'}
          {client.branch_selection.selected_k != null && (
            <>{' · '}{client.branch_selection.selected_k} {client.branch_selection.selected_k === 1 ? 'branch' : 'branches'}</>
          )}
          {' · Last analysis: '}{lastRun ?? 'never'}
        </p>
      </div>
      <Link
        to={`/accounts/${accountId}/clients/${client.id}/analysis`}
        className="px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 whitespace-nowrap"
      >
        {hasAnalysis ? 'View Analysis →' : 'Start Analysis →'}
      </Link>
    </li>
  )
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 'just now'
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`
  return `${Math.floor(day / 30)} mo ago`
}
