import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Search, Users } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import AppShell from '../../components/layout/AppShell'
import Button from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState } from '../../components/ui/ErrorState'
import { Input } from '../../components/ui/Input'
import { Skeleton } from '../../components/ui/Skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/Table'
import type { Account } from '../../types'

const TYPE_LABEL: Record<string, string> = {
  self_managed: 'Self-Managed',
  property_manager: 'Property Manager',
}

interface AccountRow extends Account {
  client_count?: number
  service_location_count?: number
}

export default function AccountsListPage() {
  const { getToken } = useAuth()
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const abortTimeout = setTimeout(() => controller.abort(), 10000)

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const token = await getToken()
        const params = new URLSearchParams()
        if (search) params.set('search', search)
        const res = await fetch(`/api/v1/accounts?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`Server error (${res.status})`)
        if (!cancelled) setAccounts(await res.json())
      } catch (err) {
        if (!cancelled) {
          const isTimeout = err instanceof DOMException && err.name === 'AbortError'
          setError(
            isTimeout
              ? 'Request timed out — the server is taking too long to respond.'
              : err instanceof Error
                ? err.message
                : 'Failed to load accounts'
          )
        }
      } finally {
        clearTimeout(abortTimeout)
        if (!cancelled) setLoading(false)
      }
    }

    const debounce = setTimeout(load, search ? 300 : 0)
    return () => {
      cancelled = true
      clearTimeout(debounce)
      clearTimeout(abortTimeout)
      controller.abort()
    }
  }, [search, getToken, retryCount])

  return (
    <AppShell breadcrumb={[{ label: 'Accounts' }]}>
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        <header className="flex items-start justify-between gap-6 flex-wrap">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-fg">
              Accounts
            </h1>
            <p className="text-sm text-fg-muted">
              {accounts.length > 0 && (
                <>
                  <span className="font-tabular">{accounts.length}</span>{' '}
                  {accounts.length === 1 ? 'account' : 'accounts'}
                </>
              )}
            </p>
          </div>
          <Button asChild>
            <Link to="/accounts/new">+ New account</Link>
          </Button>
        </header>

        <div className="relative max-w-sm">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-subtle pointer-events-none"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Search accounts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        {loading ? (
          <Card padding="none">
            <div className="space-y-2 p-6">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          </Card>
        ) : error ? (
          <ErrorState
            title="Couldn't load accounts"
            description={error}
            onRetry={() => setRetryCount((c) => c + 1)}
          />
        ) : accounts.length === 0 ? (
          <Card padding="none">
            <EmptyState
              icon={Users}
              title={search ? 'No accounts match your search' : 'No accounts yet'}
              description={
                search
                  ? 'Try a different search term, or clear the filter.'
                  : 'Create your first account to start managing portfolios.'
              }
              action={
                !search && (
                  <Button asChild>
                    <Link to="/accounts/new">Create your first account →</Link>
                  </Button>
                )
              }
            />
          </Card>
        ) : (
          <Card padding="none">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Link
                        to={`/accounts/${a.id}`}
                        className="font-medium text-fg hover:text-accent transition-colors"
                      >
                        {a.display_name ?? a.name}
                      </Link>
                      {a.display_name && (
                        <p className="text-xs text-fg-subtle">{a.name}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={a.account_type === 'property_manager' ? 'accent' : 'default'}>
                        {TYPE_LABEL[a.account_type] ?? a.account_type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={a.status === 'active' ? 'success' : 'default'}>
                        {a.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-fg-muted">
                      {a.primary_contact_name ?? '—'}
                      {a.primary_contact_email && (
                        <div className="text-fg-subtle">{a.primary_contact_email}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        to={`/accounts/${a.id}`}
                        className="text-xs text-accent hover:underline"
                      >
                        View →
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </AppShell>
  )
}
