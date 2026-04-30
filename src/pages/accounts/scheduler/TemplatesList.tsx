// Phase 4d — Routing templates list.
import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import AppShell from '../../../components/layout/AppShell'
import Button from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { Card } from '../../../components/ui/Card'
import { EmptyState } from '../../../components/ui/EmptyState'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../../components/ui/Table'

interface TemplateRow {
  id: string
  name: string
  status: string
  crew_count: number
  cycle_length_days: number
  cycle_length_label: string
  total_visits_per_cycle: number | null
  total_estimated_cost_per_year: number | null
  optimization_score: number | null
  created_at: string
}

export default function TemplatesListPage() {
  const { accountId, clientId } = useParams<{ accountId: string; clientId: string }>()
  const { getToken } = useAuth()
  const [rows, setRows] = useState<TemplateRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!accountId || !clientId) return
    setLoading(true)
    try {
      const token = await getToken()
      const res = await fetch(
        `/api/scheduler/templates?account_id=${accountId}&client_id=${clientId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!res.ok) throw new Error(`Load failed (${res.status})`)
      const data = await res.json()
      setRows(data.templates ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [accountId, clientId, getToken])

  useEffect(() => { load() }, [load])

  return (
    <AppShell breadcrumb={[{ label: 'Accounts', to: '/accounts' }, { label: 'Routing templates' }]}>
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-fg">Routing templates</h1>
            <p className="text-sm text-fg-muted">
              A template is the abstract structure for a recurring cycle of routed visits.
              Create one, then generate calendar-specific cycle instances from it.
            </p>
          </div>
          <Button asChild>
            <Link to={`/accounts/${accountId}/clients/${clientId}/scheduler/templates/new`}>
              <Plus className="h-4 w-4" />
              New template
            </Link>
          </Button>
        </header>

        {error && <p className="text-sm text-danger">{error}</p>}

        {loading ? (
          <p className="text-sm text-fg-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No templates yet"
            description="Generate a routing template to plan recurring crew routes for routed offerings."
            action={
              <Button asChild variant="secondary">
                <Link to={`/accounts/${accountId}/clients/${clientId}/scheduler/templates/new`}>
                  <Plus className="h-4 w-4" />
                  Create your first template
                </Link>
              </Button>
            }
          />
        ) : (
          <Card padding="none">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Cycle</TableHead>
                  <TableHead>Crews</TableHead>
                  <TableHead>Visits/cycle</TableHead>
                  <TableHead>Annual cost</TableHead>
                  <TableHead>Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer">
                    <TableCell>
                      <Link
                        to={`/accounts/${accountId}/clients/${clientId}/scheduler/templates/${r.id}`}
                        className="text-accent hover:underline"
                      >
                        {r.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={
                        r.status === 'active' ? 'success'
                        : r.status === 'optimizing' ? 'warning'
                        : r.status === 'failed' ? 'danger'
                        : 'outline'
                      }>{r.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{r.cycle_length_label}</TableCell>
                    <TableCell numeric>{r.crew_count}</TableCell>
                    <TableCell numeric>{r.total_visits_per_cycle ?? '—'}</TableCell>
                    <TableCell numeric>
                      {r.total_estimated_cost_per_year != null
                        ? `$${Math.round(r.total_estimated_cost_per_year).toLocaleString()}`
                        : '—'}
                    </TableCell>
                    <TableCell numeric>
                      {r.optimization_score != null ? Math.round(r.optimization_score) : '—'}
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
