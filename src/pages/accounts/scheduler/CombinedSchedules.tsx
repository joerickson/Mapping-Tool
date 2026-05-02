// Phase 4.6 — Combined Schedules: account-level page that lists all
// combined routing templates and lets the operator create new ones
// by picking N clients to synthesize into a single schedule.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Plus, Layers } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import AppShell from '../../../components/layout/AppShell'
import Button from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { Card } from '../../../components/ui/Card'
import { EmptyState } from '../../../components/ui/EmptyState'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../../components/ui/Table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '../../../components/ui/Dialog'
import { Input, FormField } from '../../../components/ui/Input'

interface TemplateRow {
  id: string
  name: string
  status: string
  client_id: string
  crew_count: number
  cycle_length_days: number
  cycle_length_label: string
  total_visits_per_cycle: number | null
  optimization_score: number | null
  combined_client_ids: string[] | null
  created_at: string
}

interface ClientRow {
  id: string
  name: string
  display_name: string | null
  status: string
  account_id: string
  account_name?: string
}

interface AccountRow {
  id: string
  name: string
  display_name: string | null
}

export default function CombinedSchedulesPage() {
  const { accountId } = useParams<{ accountId: string }>()
  const { getToken } = useAuth()
  const navigate = useNavigate()
  const [rows, setRows] = useState<TemplateRow[]>([])
  const [clients, setClients] = useState<ClientRow[]>([])
  const [account, setAccount] = useState<{ name: string; display_name: string | null } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const token = await getToken()
      const headers = { Authorization: `Bearer ${token}` }
      const [tplRes, accRes, cliRes, allAccRes] = await Promise.all([
        fetch(`/api/scheduler/templates?account_id=${accountId}&combined=true`, { headers }),
        fetch(`/api/accounts/${accountId}`, { headers }),
        fetch(`/api/v1/clients`, { headers }),
        fetch(`/api/v1/accounts`, { headers }),
      ])
      if (!tplRes.ok) throw new Error(`Load failed (${tplRes.status})`)
      const data = await tplRes.json()
      setRows(data.templates ?? [])
      if (accRes.ok) {
        const j = await accRes.json()
        setAccount(j.account ?? j)
      }
      const accList: AccountRow[] = allAccRes.ok ? await allAccRes.json() : []
      const accNameById = new Map(accList.map((a) => [a.id, a.display_name ?? a.name]))
      if (cliRes.ok) {
        const cli = await cliRes.json()
        const list = (cli.clients ?? cli) as ClientRow[]
        const enriched = list
          .filter((c) => c.status !== 'churned')
          .map((c) => ({ ...c, account_name: accNameById.get(c.account_id) ?? '—' }))
        setClients(enriched)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [accountId, getToken])

  useEffect(() => { load() }, [load])

  return (
    <AppShell
      breadcrumb={[
        { label: 'Accounts', to: '/accounts' },
        { label: account?.display_name ?? account?.name ?? '…', to: `/accounts/${accountId}` },
        { label: 'Combined schedules' },
      ]}
    >
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-fg flex items-center gap-2">
              <Layers className="h-6 w-6 text-accent" />
              Combined schedules
            </h1>
            <p className="text-sm text-fg-muted max-w-2xl">
              Synthesize a single schedule across multiple clients — including clients in
              other accounts. Pick a base client in this account (its branches and constraints
              drive the engine), then add any clients to combine with it.
            </p>
          </div>
          <Button
            onClick={() => setCreateOpen(true)}
            disabled={clients.filter((c) => c.account_id === accountId).length < 1 || clients.length < 2}
          >
            <Plus className="h-4 w-4" />
            New combined schedule
          </Button>
        </header>

        {error && <p className="text-sm text-danger">{error}</p>}

        {loading ? (
          <p className="text-sm text-fg-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No combined schedules yet"
            description={
              clients.filter((c) => c.account_id === accountId).length === 0
                ? 'This account has no clients yet. Add at least one before combining.'
                : clients.length < 2
                  ? 'You need at least 2 active clients across the system to combine. Add clients first.'
                  : 'Click "New combined schedule" to synthesize a route across multiple clients.'
            }
          />
        ) : (
          <Card padding="none">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Clients</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Crews</TableHead>
                  <TableHead className="text-right">Visits/cycle</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <Link
                        to={`/accounts/${accountId}/clients/${t.client_id}/scheduler/templates/${t.id}`}
                        className="font-medium text-accent hover:underline"
                      >
                        {t.name}
                      </Link>
                      <p className="text-[11px] text-fg-subtle">{t.cycle_length_label}</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(t.combined_client_ids ?? []).slice(0, 4).map((cid) => {
                          const c = clients.find((x) => x.id === cid)
                          const label = c?.display_name ?? c?.name ?? cid.slice(0, 8)
                          const isExternal = c && c.account_id !== accountId
                          return (
                            <Badge
                              key={cid}
                              variant="outline"
                              className="text-[10px]"
                              title={isExternal ? `External account: ${c?.account_name}` : undefined}
                            >
                              {label}
                              {isExternal && (
                                <span className="ml-1 text-fg-subtle">· {c?.account_name}</span>
                              )}
                            </Badge>
                          )
                        })}
                        {(t.combined_client_ids ?? []).length > 4 && (
                          <span className="text-[11px] text-fg-subtle self-center">
                            +{(t.combined_client_ids ?? []).length - 4}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={t.status === 'active' ? 'success' : 'outline'}>
                        {t.status}
                      </Badge>
                    </TableCell>
                    <TableCell numeric>{t.crew_count}</TableCell>
                    <TableCell numeric>{t.total_visits_per_cycle ?? '—'}</TableCell>
                    <TableCell numeric>
                      {t.optimization_score != null ? `${t.optimization_score}/100` : '—'}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      {createOpen && (
        <CreateCombinedDialog
          accountId={accountId!}
          clients={clients}
          onClose={() => setCreateOpen(false)}
          onCreated={(templateId, baseClientId) => {
            setCreateOpen(false)
            navigate(
              `/accounts/${accountId}/clients/${baseClientId}/scheduler/templates/${templateId}`
            )
          }}
        />
      )}
    </AppShell>
  )
}

function CreateCombinedDialog({
  accountId,
  clients,
  onClose,
  onCreated,
}: {
  accountId: string
  clients: ClientRow[]
  onClose: () => void
  onCreated: (templateId: string, baseClientId: string) => void
}) {
  const { getToken } = useAuth()
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [baseClientId, setBaseClientId] = useState<string>('')
  const [crewCount, setCrewCount] = useState('4')
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  // Group clients by account name for the picker. Clients in the URL's
  // account come first (those are eligible to be the base), then others.
  const grouped = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const matches = (c: ClientRow) => {
      if (!q) return true
      const hay = `${c.display_name ?? c.name} ${c.account_name ?? ''}`.toLowerCase()
      return hay.includes(q)
    }
    const inAccount = clients.filter((c) => c.account_id === accountId && matches(c))
    const others = clients.filter((c) => c.account_id !== accountId && matches(c))
    const byAccount = new Map<string, ClientRow[]>()
    for (const c of others) {
      const arr = byAccount.get(c.account_name ?? '—') ?? []
      arr.push(c)
      byAccount.set(c.account_name ?? '—', arr)
    }
    return {
      base: inAccount,
      others: Array.from(byAccount.entries()).sort((a, b) => a[0].localeCompare(b[0])),
    }
  }, [clients, accountId, filter])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      // Auto-set base to first eligible (in-account) selection if unset.
      if (!baseClientId && next.size > 0) {
        const firstInAccount = clients.find((c) =>
          next.has(c.id) && c.account_id === accountId
        )
        if (firstInAccount) setBaseClientId(firstInAccount.id)
      }
      return next
    })
  }

  const create = async () => {
    setErr(null)
    if (selected.size < 2) {
      setErr('Pick at least 2 clients to combine')
      return
    }
    if (!baseClientId || !selected.has(baseClientId)) {
      setErr('Pick a base client (constraints come from this client)')
      return
    }
    const base = clients.find((c) => c.id === baseClientId)
    if (base && base.account_id !== accountId) {
      setErr('Base client must be in this account. Pick a base from the top group.')
      return
    }
    if (!name.trim()) {
      setErr('Name is required')
      return
    }
    const n = Math.max(1, Math.floor(Number(crewCount) || 1))
    setCreating(true)
    try {
      const token = await getToken()
      const res = await fetch('/api/scheduler/templates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          account_id: accountId,
          client_id: baseClientId,
          combined_client_ids: Array.from(selected),
          name: name.trim(),
          crew_count: n,
        }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error((j as any).error ?? `HTTP ${res.status}`)
      const tplId = j.template?.id ?? j.id
      onCreated(tplId, baseClientId)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New combined schedule</DialogTitle>
          <DialogDescription>
            Pick the clients to synthesize into one schedule. The engine will route across
            all of them and place visits on a single set of crews. Select a base client —
            its operational constraints (crew size, hours/day, drive speed) drive the engine.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <FormField label="Name">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. IFS + JLL combined Q1"
            />
          </FormField>

          <FormField label={`Clients to combine (${selected.size} selected)`}>
            <div className="space-y-2">
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter clients or accounts…"
              />
              <div className="max-h-72 overflow-y-auto rounded-md border border-border">
                {grouped.base.length > 0 && (
                  <ClientGroup
                    label="This account (eligible as base)"
                    clients={grouped.base}
                    selected={selected}
                    baseClientId={baseClientId}
                    canSetBase
                    onToggle={toggle}
                    onSetBase={setBaseClientId}
                  />
                )}
                {grouped.others.map(([accName, list]) => (
                  <ClientGroup
                    key={accName}
                    label={accName}
                    clients={list}
                    selected={selected}
                    baseClientId={baseClientId}
                    canSetBase={false}
                    onToggle={toggle}
                    onSetBase={setBaseClientId}
                  />
                ))}
                {grouped.base.length === 0 && grouped.others.length === 0 && (
                  <p className="px-3 py-4 text-xs text-fg-subtle">No clients match that filter.</p>
                )}
              </div>
            </div>
          </FormField>

          <FormField label="Crew count">
            <Input
              type="number"
              min={1}
              value={crewCount}
              onChange={(e) => setCrewCount(e.target.value)}
            />
          </FormField>
        </div>

        {err && (
          <p className="text-xs text-danger border border-danger/30 bg-danger-subtle rounded-md px-2 py-1">
            {err}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={creating}>Cancel</Button>
          <Button onClick={create} loading={creating}>Create + optimize</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ClientGroup({
  label,
  clients,
  selected,
  baseClientId,
  canSetBase,
  onToggle,
  onSetBase,
}: {
  label: string
  clients: ClientRow[]
  selected: Set<string>
  baseClientId: string
  canSetBase: boolean
  onToggle: (id: string) => void
  onSetBase: (id: string) => void
}) {
  if (clients.length === 0) return null
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="bg-surface-muted px-3 py-1 text-[10px] uppercase tracking-wide text-fg-subtle">
        {label}
      </div>
      <ul className="divide-y divide-border">
        {clients.map((c) => {
          const isBase = c.id === baseClientId
          const checked = selected.has(c.id)
          return (
            <li key={c.id} className="flex items-center gap-2 px-3 py-1.5">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(c.id)}
                className="rounded border-border accent-accent"
              />
              <span className="flex-1 text-sm text-fg">
                {c.display_name ?? c.name}
              </span>
              {checked && canSetBase && (
                <button
                  type="button"
                  onClick={() => onSetBase(c.id)}
                  className={
                    'rounded border px-2 py-0.5 text-[10px] ' +
                    (isBase
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border text-fg-muted hover:bg-surface-muted')
                  }
                >
                  {isBase ? 'Base ✓' : 'Set as base'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
