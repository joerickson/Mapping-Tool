import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Building2, Home, Settings, Users, X } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import Button from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Card } from '../../components/ui/Card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/Dialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { FormField, Input, Textarea } from '../../components/ui/Input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/Select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/Table'
import AppShell from '../../components/layout/AppShell'
import {
  Sidebar,
  SidebarItem,
  SidebarSection,
} from '../../components/layout/Sidebar'
import { cn } from '../../lib/cn'
import { useCountUp } from '../../hooks/useCountUp'
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
      <div className="mx-auto max-w-5xl px-6 py-10 space-y-10">
        {error && (
          <div
            role="alert"
            className="rounded-md border border-danger/20 bg-danger-subtle px-3 py-2 text-sm text-danger"
          >
            {error}
          </div>
        )}

        {/* Header — page title + tagline + edit affordance. No decorative
            chrome; the type-of-account label lives as a subtle Badge. */}
        <header className="flex items-start justify-between gap-6">
          <div className="space-y-2 min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-fg truncate">
                {account.display_name ?? account.name}
              </h1>
              <Badge variant={isPM ? 'accent' : 'default'}>
                {TYPE_LABEL[account.account_type]}
              </Badge>
            </div>
            <p className="text-sm text-fg-muted">
              <PortfolioTagline overview={overview} fallbackClientCount={account.stats.client_count} />
              {account.display_name && (
                <span className="text-fg-subtle"> · {account.name}</span>
              )}
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </header>

        {/* Phase 3.6 — bounced-from-legacy-analysis banner. Warning palette. */}
        {fromLegacyAnalysis && (
          <div
            role="status"
            className="flex items-start justify-between gap-4 rounded-md border border-warning/20 bg-warning-subtle px-4 py-3 text-sm text-warning"
          >
            <p>
              Smart Analysis is now per-client. Pick a client below to continue.
            </p>
            <button
              type="button"
              onClick={() => {
                searchParams.delete('from')
                setSearchParams(searchParams, { replace: true })
              }}
              aria-label="Dismiss banner"
              className="shrink-0 text-warning/70 hover:text-warning transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Aggregate stats — big numbers in monospace, label below in caps. */}
        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard
            label="Clients"
            value={overview?.client_count ?? account.stats.client_count}
          />
          <StatCard
            label="Properties"
            value={overview?.total_properties}
          />
          <StatCard
            label="Service Locations"
            value={overview?.total_service_locations ?? account.stats.service_location_count}
          />
          <StatCard
            label="States"
            value={overview?.unique_states}
          />
        </section>

        {/* Clients section. Per-client interactive cards with synthesis status
            + Analysis CTA. Uses the design-system Card hover state instead of
            divide-y row dividers — feels more like a list of "things you can
            click into" than a static table. */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold tracking-tight text-fg">
              Clients
            </h2>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" asChild>
                <Link to={`/accounts/${id}/combined-schedules`}>Combined schedules</Link>
              </Button>
              {isPM && (
                <Button size="sm" variant="secondary" asChild>
                  <Link to={`/accounts/${id}/clients/new`}>+ Add client</Link>
                </Button>
              )}
            </div>
          </div>

          {clientsForDisplay(overview, clients).length === 0 ? (
            <Card padding="none">
              <EmptyState
                icon={Users}
                title="No clients yet"
                description={
                  isPM
                    ? 'Add a client to start running portfolio analysis.'
                    : 'No clients are configured for this account.'
                }
                action={
                  isPM ? (
                    <Button size="sm" asChild>
                      <Link to={`/accounts/${id}/clients/new`}>
                        Add your first client →
                      </Link>
                    </Button>
                  ) : undefined
                }
              />
            </Card>
          ) : (
            <ul className="space-y-2">
              {clientsForDisplay(overview, clients).map((c) => (
                <ClientOverviewRow
                  key={c.id}
                  accountId={id!}
                  client={c}
                  pending={!overview}
                />
              ))}
            </ul>
          )}
        </section>

        {/* Self-managed: surface client setup banner */}
        {!isPM && selfClient && <ClientSetupBanner client={selfClient} />}

        {/* Recent uploads. Hidden when empty — no value in showing a stub. */}
        {account.recent_uploads.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-xl font-semibold tracking-tight text-fg">
              Recent uploads
            </h2>
            <Card padding="none">
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
                  {account.recent_uploads.map((u) => (
                    <TableRow key={u.upload_batch_id}>
                      <TableCell className="font-mono text-xs text-fg">
                        {u.filename}
                      </TableCell>
                      <TableCell numeric>{u.row_count.toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge variant={uploadStatusVariant(u.status)}>
                          {u.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-fg-muted">
                        {new Date(u.created_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </section>
        )}
      </div>

      {/* Edit dialog. Phase D1 — replaces the legacy fixed-overlay modal with
          the design-system Dialog so a11y + animations come for free. */}
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit account</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            {error && (
              <div
                role="alert"
                className="rounded-md border border-danger/20 bg-danger-subtle px-3 py-2 text-sm text-danger"
              >
                {error}
              </div>
            )}
            <FormField label="Name *" htmlFor="edit-account-name">
              <Input
                id="edit-account-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </FormField>
            <FormField label="Display name" htmlFor="edit-account-display">
              <Input
                id="edit-account-display"
                value={editDisplayName}
                onChange={(e) => setEditDisplayName(e.target.value)}
              />
            </FormField>
            <FormField label="Status" htmlFor="edit-account-status">
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger id="edit-account-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField label="Contact name" htmlFor="edit-account-contact-name">
                <Input
                  id="edit-account-contact-name"
                  value={editContactName}
                  onChange={(e) => setEditContactName(e.target.value)}
                />
              </FormField>
              <FormField label="Contact email" htmlFor="edit-account-contact-email">
                <Input
                  id="edit-account-contact-email"
                  type="email"
                  value={editContactEmail}
                  onChange={(e) => setEditContactEmail(e.target.value)}
                />
              </FormField>
            </div>
            <FormField label="Contact phone" htmlFor="edit-account-contact-phone">
              <Input
                id="edit-account-contact-phone"
                type="tel"
                value={editContactPhone}
                onChange={(e) => setEditContactPhone(e.target.value)}
              />
            </FormField>
            <FormField label="Notes" htmlFor="edit-account-notes">
              <Textarea
                id="edit-account-notes"
                value={editNotes}
                rows={3}
                onChange={(e) => setEditNotes(e.target.value)}
              />
            </FormField>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button loading={saving} onClick={handleSave}>
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}

// Stat card. Big monospace number per design rules ("Numbers are first-class").
// `value` accepts number | string — falsy / missing renders the em-dash so the
// card doesn't collapse while overview data is loading.
function StatCard({
  label,
  value,
}: {
  label: string
  value: number | string | null | undefined
}) {
  // Numeric values count up from 0 → final on first hydrate (and tween
  // between any subsequent updates). Non-numeric stays static — strings
  // can't be interpolated.
  const numeric = typeof value === 'number' ? value : null
  const animated = useCountUp(numeric)
  const display =
    numeric != null
      ? Math.round(animated).toLocaleString()
      : value && String(value).length > 0
        ? value
        : '—'
  return (
    <Card padding="md">
      <p className="font-mono text-3xl font-semibold tabular-nums text-fg leading-none">
        {display}
      </p>
      <p className="mt-2 text-xs uppercase tracking-wide text-fg-subtle">
        {label}
      </p>
    </Card>
  )
}

// Header subtitle: "Portfolio of N clients · M properties · K states".
// Falls back to the bare client count from /v1/accounts when /overview hasn't
// returned yet so the line never shows partial dashes.
function PortfolioTagline({
  overview,
  fallbackClientCount,
}: {
  overview: AccountOverview | null
  fallbackClientCount: number
}) {
  if (!overview) {
    return (
      <span>
        Portfolio of {fallbackClientCount}{' '}
        {fallbackClientCount === 1 ? 'client' : 'clients'}
      </span>
    )
  }
  const parts: string[] = [
    `${overview.client_count} ${overview.client_count === 1 ? 'client' : 'clients'}`,
  ]
  if (overview.total_properties)
    parts.push(`${overview.total_properties.toLocaleString()} properties`)
  if (overview.unique_states)
    parts.push(`${overview.unique_states} ${overview.unique_states === 1 ? 'state' : 'states'}`)
  return <span>Portfolio of {parts.join(' · ')}</span>
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
    <Link
      to={`/clients/${client.id}/setup`}
      className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
    >
      Configure client setup →
    </Link>
  )
}

// Per-client interactive row. Whole row is clickable (Link wraps it) — the
// trailing button is visually a CTA but the click target spans the full
// width. Hover state shifts surface + border per the design rules.
function ClientOverviewRow({
  accountId,
  client,
  pending,
}: {
  accountId: string
  client: OverviewClient | Pick<OverviewClient, 'id' | 'name' | 'display_name' | 'property_count'>
  /** When true, only the bare-bones fields are populated. Hide derived UI. */
  pending?: boolean
}) {
  const full = !pending && 'synthesis_status' in client
  const lastRun =
    full && (client as OverviewClient).last_analysis_at
      ? relativeTime((client as OverviewClient).last_analysis_at!)
      : null
  const hasAnalysis = full && !!(client as OverviewClient).last_analysis_at
  const ctaLabel = pending
    ? 'Open analysis →'
    : hasAnalysis
      ? 'View Analysis →'
      : 'Start Analysis →'

  return (
    <li>
      <Link
        to={`/accounts/${accountId}/clients/${client.id}/analysis`}
        className={cn(
          'group block rounded-lg border border-border bg-surface px-5 py-4',
          'transition-colors duration-150',
          'hover:bg-surface-subtle hover:border-border-strong',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'
        )}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base font-semibold text-fg truncate">
                {client.display_name ?? client.name}
              </span>
              {full && synthesisBadge((client as OverviewClient).synthesis_status)}
            </div>
            <p className="mt-1 text-xs text-fg-muted">
              <span className="font-tabular">{client.property_count}</span>{' '}
              {client.property_count === 1 ? 'property' : 'properties'}
              {full && (
                <>
                  {' · '}
                  <span className="font-tabular">
                    {(client as OverviewClient).states_count}
                  </span>{' '}
                  {(client as OverviewClient).states_count === 1 ? 'state' : 'states'}
                  {(client as OverviewClient).branch_selection.selected_k != null && (
                    <>
                      {' · '}
                      <span className="font-tabular">
                        {(client as OverviewClient).branch_selection.selected_k}
                      </span>{' '}
                      {(client as OverviewClient).branch_selection.selected_k === 1
                        ? 'branch'
                        : 'branches'}
                    </>
                  )}
                  {' · Last activity: '}
                  {lastRun ?? 'never'}
                </>
              )}
              {pending && (
                <span className="ml-1 text-fg-subtle">· loading…</span>
              )}
            </p>
          </div>
          <span className="shrink-0 text-sm font-medium text-fg-muted group-hover:text-accent transition-colors whitespace-nowrap">
            {ctaLabel}
          </span>
        </div>
      </Link>
    </li>
  )
}

function synthesisBadge(status: 'fresh' | 'stale' | 'never') {
  switch (status) {
    case 'fresh':
      return <Badge variant="success">Synthesis fresh</Badge>
    case 'stale':
      return <Badge variant="warning">Synthesis stale</Badge>
    default:
      return null
  }
}

function uploadStatusVariant(
  status: string
): 'success' | 'danger' | 'warning' | 'default' {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'pending' || status === 'in_progress') return 'warning'
  return 'default'
}

// Picks the right shape to render the clients list, preferring the full
// /overview payload but falling back to the lite Client[] from /v1/clients
// while overview is still loading. Returning a typed union lets the row
// component skip derived UI for the pending case.
function clientsForDisplay(
  overview: AccountOverview | null,
  fallback: Client[]
):
  | OverviewClient[]
  | Pick<OverviewClient, 'id' | 'name' | 'display_name' | 'property_count'>[] {
  if (overview) return overview.clients
  return fallback.map(toOverviewLite)
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
