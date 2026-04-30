// Phase 4b — account-level audit log page.
// Route: /accounts/:accountId/clients/:clientId/admin/audit-log
//
// Filters: entity type, field name, edited_by, date range, has_cascading_effects.
// Pagination 50/page.
import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Filter as FilterIcon } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import AppShell from '../../components/layout/AppShell'
import Button from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Card, CardTitle, CardDescription } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../components/ui/Select'
import { EmptyState } from '../../components/ui/EmptyState'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/Table'
import { PROPERTY_FIELDS, SERVICE_LOCATION_FIELDS } from '../../lib/editable-fields'

const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  [...PROPERTY_FIELDS, ...SERVICE_LOCATION_FIELDS].map((f) => [f.key, f.label])
)

interface AuditEdit {
  id: string
  entity_type: 'property' | 'service_location'
  entity_id: string
  property_id: string
  service_location_id: string | null
  field_name: string
  old_value: unknown
  new_value: unknown
  edited_by: string | null
  edited_at: string
  reason: string | null
  cascading_effects: { analyses_to_stale?: string[]; reasons?: any[] } | null
}

interface AuditResponse {
  edits: AuditEdit[]
  total_count: number
  page: number
  limit: number
  has_more: boolean
}

const PAGE_SIZE = 50

export default function AuditLogPage() {
  const { accountId, clientId } = useParams<{ accountId: string; clientId: string }>()
  const { getToken } = useAuth()

  const [data, setData] = useState<AuditResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [entityType, setEntityType] = useState<'all' | 'property' | 'service_location'>('all')
  const [editedBy, setEditedBy] = useState('')
  const [hasCascade, setHasCascade] = useState<'any' | 'true' | 'false'>('any')
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    if (!accountId || !clientId) return
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      const params = new URLSearchParams()
      params.set('limit', String(PAGE_SIZE))
      params.set('page', String(page))
      if (entityType !== 'all') params.set('entity_type', entityType)
      if (editedBy.trim()) params.set('edited_by', editedBy.trim())
      if (hasCascade !== 'any') params.set('has_cascading_effects', hasCascade)

      const res = await fetch(
        `/api/accounts/${accountId}/clients/${clientId}/edit-history?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [accountId, clientId, page, entityType, editedBy, hasCascade, getToken])

  useEffect(() => { load() }, [load])

  function applyFilters() {
    setPage(1)
    load()
  }

  function resetFilters() {
    setEntityType('all')
    setEditedBy('')
    setHasCascade('any')
    setPage(1)
  }

  return (
    <AppShell
      breadcrumb={[
        { label: 'Accounts', to: '/accounts' },
        { label: 'Audit log' },
      ]}
    >
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Edit history</h1>
          <p className="text-sm text-fg-muted">
            All property and service location edits across this client.
          </p>
        </header>

        {/* Filter bar */}
        <Card>
          <div className="flex items-center gap-2 mb-3 text-xs text-fg-muted">
            <FilterIcon className="h-3.5 w-3.5" />
            <span>Filters</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Entity type">
              <Select value={entityType} onValueChange={(v) => setEntityType(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="property">Property</SelectItem>
                  <SelectItem value="service_location">Service location</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Edited by (email contains)">
              <Input
                value={editedBy}
                onChange={(e) => setEditedBy(e.target.value)}
                placeholder="e.g. jon@"
              />
            </FilterField>
            <FilterField label="Cascading effects">
              <Select value={hasCascade} onValueChange={(v) => setHasCascade(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="true">Yes — staled modules</SelectItem>
                  <SelectItem value="false">No — no cascade</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <div className="flex items-end gap-2">
              <Button onClick={applyFilters} loading={loading}>Apply</Button>
              <Button variant="ghost" onClick={resetFilters}>Reset</Button>
            </div>
          </div>
        </Card>

        {error && <p className="text-sm text-danger">Error: {error}</p>}

        {/* Results table */}
        {loading && !data ? (
          <p className="text-sm text-fg-muted">Loading…</p>
        ) : !data || data.edits.length === 0 ? (
          <EmptyState
            title="No edits yet"
            description="When users edit properties or service locations, the changes appear here."
          />
        ) : (
          <Card padding="none">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Field</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Cascade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.edits.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-fg-muted whitespace-nowrap font-tabular text-xs">
                      {new Date(e.edited_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/properties/${e.property_id}`}
                        className="text-accent hover:underline text-xs"
                      >
                        {e.entity_type === 'service_location' ? 'SL' : 'Property'}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">
                      {FIELD_LABELS[e.field_name] ?? e.field_name}
                    </TableCell>
                    <TableCell>
                      <DiffChips old={e.old_value} next={e.new_value} />
                    </TableCell>
                    <TableCell className="text-xs text-fg-muted">{e.edited_by ?? '—'}</TableCell>
                    <TableCell>
                      {e.cascading_effects?.analyses_to_stale &&
                      e.cascading_effects.analyses_to_stale.length > 0 ? (
                        <Badge variant="warning">
                          {e.cascading_effects.analyses_to_stale.length}
                        </Badge>
                      ) : (
                        <span className="text-xs text-fg-subtle">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}

        {/* Pagination */}
        {data && data.total_count > 0 && (
          <div className="flex items-center justify-between text-xs text-fg-muted">
            <span>
              Showing{' '}
              <span className="font-tabular">
                {(page - 1) * PAGE_SIZE + 1}–
                {Math.min(page * PAGE_SIZE, data.total_count)}
              </span>{' '}
              of <span className="font-tabular">{data.total_count}</span>
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={page === 1 || loading}
                onClick={() => setPage((p) => p - 1)}
              >
                ← Prev
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!data.has_more || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Next →
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle mb-1">
        {label}
      </p>
      {children}
    </div>
  )
}

function DiffChips({ old: oldV, next }: { old: unknown; next: unknown }) {
  return (
    <div className="flex items-center gap-1 text-xs flex-wrap">
      <code className="rounded bg-surface-elevated text-fg-muted line-through decoration-fg-subtle px-1 py-0.5 max-w-[150px] truncate">
        {format(oldV)}
      </code>
      <span className="text-fg-subtle">→</span>
      <code className="rounded bg-accent/10 text-fg px-1 py-0.5 max-w-[150px] truncate">
        {format(next)}
      </code>
    </div>
  )
}

function format(v: unknown): string {
  if (v == null) return '—'
  if (Array.isArray(v)) return v.length === 0 ? '[]' : `[${v.join(', ')}]`
  if (typeof v === 'object') return JSON.stringify(v)
  if (typeof v === 'number') return v.toLocaleString()
  return String(v)
}
