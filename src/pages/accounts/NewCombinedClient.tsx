import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import AppShell from '../../components/layout/AppShell'
import Button from '../../components/ui/Button'
import { Card, CardTitle } from '../../components/ui/Card'
import { Input, Textarea, FormField } from '../../components/ui/Input'

interface ClientRow {
  id: string
  name: string
  display_name: string | null
  status: string
  account_id: string
  is_combined?: boolean
  account_name?: string
}

interface AccountRow {
  id: string
  name: string
  display_name: string | null
}

export default function NewCombinedClientPage() {
  const { id: accountId } = useParams<{ id: string }>()
  const { getToken } = useAuth()
  const navigate = useNavigate()

  const [account, setAccount] = useState<{ id: string; name: string; display_name: string | null } | null>(null)
  const [clients, setClients] = useState<ClientRow[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [notes, setNotes] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const token = await getToken()
      const headers = { Authorization: `Bearer ${token}` }
      const [accRes, cliRes, allAccRes] = await Promise.all([
        fetch(`/api/v1/accounts/${accountId}`, { headers }),
        fetch(`/api/v1/clients`, { headers }),
        fetch(`/api/v1/accounts`, { headers }),
      ])
      if (accRes.ok) setAccount(await accRes.json())
      const accList: AccountRow[] = allAccRes.ok ? await allAccRes.json() : []
      const accNameById = new Map(accList.map((a) => [a.id, a.display_name ?? a.name]))
      if (cliRes.ok) {
        const list = (await cliRes.json()) as ClientRow[]
        setClients(
          list
            .filter((c) => c.status !== 'churned' && !c.is_combined)
            .map((c) => ({ ...c, account_name: accNameById.get(c.account_id) ?? '—' }))
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [accountId, getToken])

  useEffect(() => { load() }, [load])

  const grouped = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const matches = (c: ClientRow) =>
      !q || `${c.display_name ?? c.name} ${c.account_name ?? ''}`.toLowerCase().includes(q)
    const inAccount = clients.filter((c) => c.account_id === accountId && matches(c))
    const others = clients.filter((c) => c.account_id !== accountId && matches(c))
    const byAccount = new Map<string, ClientRow[]>()
    for (const c of others) {
      const arr = byAccount.get(c.account_name ?? '—') ?? []
      arr.push(c)
      byAccount.set(c.account_name ?? '—', arr)
    }
    return {
      thisAccount: inAccount,
      others: Array.from(byAccount.entries()).sort((a, b) => a[0].localeCompare(b[0])),
    }
  }, [clients, accountId, filter])

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) return setError('Name is required')
    if (selected.size < 2) return setError('Pick at least 2 member clients')
    setSaving(true)
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/accounts/${accountId}/clients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: name.trim(),
          display_name: displayName.trim() || null,
          notes: notes.trim() || null,
          is_combined: true,
          member_client_ids: Array.from(selected),
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Failed to create combined client')
      navigate(`/clients/${body.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppShell
      breadcrumb={[
        { label: 'Accounts', to: '/accounts' },
        { label: account?.display_name ?? account?.name ?? '…', to: `/accounts/${accountId}` },
        { label: 'New combined client' },
      ]}
    >
      <div className="mx-auto max-w-3xl px-6 py-10 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">New combined client</h1>
          <p className="text-sm text-fg-muted max-w-2xl">
            A combined client is a virtual portfolio that aggregates properties from multiple
            existing clients. Smart Analysis, Branch Optimization, and the scheduler treat it
            like any other client. Member clients keep their own data and stay fully usable on
            their own.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          <Card className="space-y-4">
            <CardTitle>Details</CardTitle>
            <FormField label="Name" htmlFor="cc-name">
              <Input
                id="cc-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. IFS + JLL combined portfolio"
              />
            </FormField>
            <FormField label="Display name (optional)">
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </FormField>
            <FormField label="Notes (optional)">
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </FormField>
          </Card>

          <Card padding="none" className="overflow-hidden">
            <div className="border-b border-border px-4 py-3 flex items-center justify-between">
              <CardTitle>Member clients ({selected.size} selected)</CardTitle>
              <span className="text-xs text-fg-subtle">Combined clients cannot be members.</span>
            </div>
            <div className="px-4 py-3 border-b border-border">
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter clients or accounts…"
              />
            </div>

            {loading ? (
              <p className="px-4 py-6 text-sm text-fg-muted">Loading clients…</p>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                {grouped.thisAccount.length > 0 && (
                  <ClientGroup
                    label="This account"
                    clients={grouped.thisAccount}
                    selected={selected}
                    onToggle={toggle}
                  />
                )}
                {grouped.others.map(([accName, list]) => (
                  <ClientGroup
                    key={accName}
                    label={accName}
                    clients={list}
                    selected={selected}
                    onToggle={toggle}
                  />
                ))}
                {grouped.thisAccount.length === 0 && grouped.others.length === 0 && (
                  <p className="px-4 py-4 text-xs text-fg-subtle">
                    No clients match that filter.
                  </p>
                )}
              </div>
            )}
          </Card>

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" asChild>
              <Link to={`/accounts/${accountId}`}>Cancel</Link>
            </Button>
            <Button type="submit" loading={saving} disabled={selected.size < 2 || !name.trim()}>
              Create combined client
            </Button>
          </div>
        </form>
      </div>
    </AppShell>
  )
}

function ClientGroup({
  label,
  clients,
  selected,
  onToggle,
}: {
  label: string
  clients: ClientRow[]
  selected: Set<string>
  onToggle: (id: string) => void
}) {
  if (clients.length === 0) return null
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="bg-surface-muted px-4 py-1 text-[10px] uppercase tracking-wide text-fg-subtle">
        {label}
      </div>
      <ul className="divide-y divide-border">
        {clients.map((c) => (
          <li key={c.id} className="flex items-center gap-2 px-4 py-1.5">
            <input
              type="checkbox"
              checked={selected.has(c.id)}
              onChange={() => onToggle(c.id)}
              className="rounded border-border accent-accent"
            />
            <span className="flex-1 text-sm text-fg">
              {c.display_name ?? c.name}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
