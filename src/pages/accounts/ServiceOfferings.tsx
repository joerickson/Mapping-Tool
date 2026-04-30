// Phase 4d — Service Offerings routing configuration page.
// Route: /accounts/:accountId/clients/:clientId/admin/service-offerings
//
// Shows all offerings for the client with role + routed + frequency
// + attaches-to columns. Edit modal varies by role.
import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Pencil } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import AppShell from '../../components/layout/AppShell'
import Button from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Card, CardTitle } from '../../components/ui/Card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../../components/ui/Dialog'
import { Input, FormField } from '../../components/ui/Input'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '../../components/ui/Select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../components/ui/Table'
import { cn } from '../../lib/cn'

interface Offering {
  id: string
  name: string
  is_routed: boolean
  offering_role: 'standalone' | 'parent' | 'addon'
  visit_interval_years: number | null
  attaches_to_offering_ids: string[] | null
  uses_cohort_rotation: boolean | null
}

interface CohortSummary {
  cohort_total: number
  cohorts: Array<{ cohort_index: number; next_due_year: number; property_count: number }>
}

export default function ServiceOfferingsPage() {
  const { accountId, clientId } = useParams<{ accountId: string; clientId: string }>()
  const { getToken } = useAuth()
  const [offerings, setOfferings] = useState<Offering[]>([])
  const [editing, setEditing] = useState<Offering | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!clientId) return
    setLoading(true)
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/service-offerings?client_id=${clientId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`Load failed (${res.status})`)
      const data = await res.json()
      setOfferings(Array.isArray(data) ? data : data.items ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [clientId, getToken])

  useEffect(() => { load() }, [load])

  return (
    <AppShell breadcrumb={[{ label: 'Accounts', to: '/accounts' }, { label: 'Service offerings' }]}>
      <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Service offerings — Routing configuration</h1>
          <p className="text-sm text-fg-muted max-w-3xl">
            Routed offerings are scheduled with crew routes (a crew travels to multiple properties).
            Non-routed offerings are stationary work assigned to a person at one location and excluded
            from scheduling. Add-on offerings (like Upholstery) attach to a parent offering's visit when
            due, rather than triggering their own trip.
          </p>
        </header>

        {error && <p className="text-sm text-danger">{error}</p>}

        {loading ? (
          <p className="text-sm text-fg-muted">Loading…</p>
        ) : (
          <Card padding="none">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Offering</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Routed</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead>Attaches to</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {offerings.map((o) => {
                  const attached = (o.attaches_to_offering_ids ?? [])
                    .map((id) => offerings.find((x) => x.id === id)?.name ?? id.slice(0, 6))
                  return (
                    <TableRow
                      key={o.id}
                      className={cn(
                        o.is_routed
                          ? 'border-l-2 border-accent/50'
                          : 'opacity-70'
                      )}
                    >
                      <TableCell className="font-medium">{o.name}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            o.offering_role === 'parent' ? 'accent'
                            : o.offering_role === 'addon' ? 'warning'
                            : 'outline'
                          }
                        >
                          {o.offering_role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {o.is_routed ? '✓' : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-fg-muted">
                        {formatInterval(o.visit_interval_years)}
                      </TableCell>
                      <TableCell className="text-xs text-fg-muted">
                        {attached.length > 0 ? attached.join(', ') : '—'}
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => setEditing(o)}
                          className="text-fg-subtle hover:text-accent transition-colors"
                          aria-label="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      <EditOfferingDialog
        offering={editing}
        offerings={offerings}
        clientId={clientId ?? ''}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load() }}
      />
    </AppShell>
  )
}

function formatInterval(years: number | null): string {
  if (years == null || years === 0) return '—'
  if (years === 0.25) return 'Every 3 months (4×/yr)'
  if (years === 0.5) return 'Every 6 months (2×/yr)'
  if (years === 1) return 'Yearly (1×/yr)'
  if (years < 1) return `Every ${Math.round(years * 12)} months`
  return `Every ${years} years (cohort rotation)`
}

function EditOfferingDialog({
  offering, offerings, clientId, onClose, onSaved,
}: {
  offering: Offering | null
  offerings: Offering[]
  clientId: string
  onClose: () => void
  onSaved: () => void
}) {
  const { getToken } = useAuth()
  const [draft, setDraft] = useState<Offering | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cohort, setCohort] = useState<CohortSummary | null>(null)
  const [rebalancing, setRebalancing] = useState(false)

  useEffect(() => {
    if (offering) setDraft({ ...offering })
    else setDraft(null)
    setError(null)
    setCohort(null)
  }, [offering])

  // Load cohort summary for addons with rotation
  useEffect(() => {
    if (!offering || offering.offering_role !== 'addon' || !offering.uses_cohort_rotation) return
    let cancelled = false
    async function load() {
      const token = await getToken()
      const res = await fetch(`/api/clients/${clientId}/addon-cohorts/${offering!.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok && !cancelled) {
        const data = await res.json()
        setCohort({ cohort_total: data.cohort_total, cohorts: data.cohorts ?? [] })
      }
    }
    load()
    return () => { cancelled = true }
  }, [offering, clientId, getToken])

  if (!offering || !draft) return null

  const parentOptions = offerings.filter(
    (o) => o.id !== draft.id && o.offering_role === 'parent'
  )

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const token = await getToken()
      const patch: Record<string, unknown> = {
        is_routed: draft!.is_routed,
        offering_role: draft!.offering_role,
        visit_interval_years: draft!.visit_interval_years,
        attaches_to_offering_ids: draft!.attaches_to_offering_ids ?? [],
        uses_cohort_rotation: draft!.uses_cohort_rotation ?? false,
      }
      const res = await fetch(`/api/v1/service-offerings/${draft!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Save failed (${res.status})`)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function autoAssign() {
    setRebalancing(true)
    try {
      const token = await getToken()
      await fetch(
        `/api/clients/${clientId}/addon-cohorts/${offering!.id}/auto-assign`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ method: 'geographic' }),
        }
      )
      // Reload cohort summary
      const res = await fetch(`/api/clients/${clientId}/addon-cohorts/${offering!.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setCohort({ cohort_total: data.cohort_total, cohorts: data.cohorts ?? [] })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRebalancing(false)
    }
  }

  return (
    <Dialog open={!!offering} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit "{draft.name}"</DialogTitle>
          <DialogDescription>Configure routing role + frequency.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <FormField label="Role">
            <Select
              value={draft.offering_role}
              onValueChange={(v) =>
                setDraft({
                  ...draft,
                  offering_role: v as Offering['offering_role'],
                  is_routed: v !== 'standalone',
                })
              }
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="standalone">Standalone (not routed)</SelectItem>
                <SelectItem value="parent">Parent (triggers routed visits)</SelectItem>
                <SelectItem value="addon">Add-on (attaches to parent)</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          {draft.offering_role !== 'standalone' && (
            <FormField label="Visit interval (years)" helper="0.5 = every 6 months / 2× per year">
              <Input
                type="number"
                step="any"
                min={0}
                value={draft.visit_interval_years ?? ''}
                onChange={(e) => {
                  const n = e.target.value === '' ? null : Number(e.target.value)
                  setDraft({
                    ...draft,
                    visit_interval_years: n,
                    uses_cohort_rotation:
                      draft.offering_role === 'addon' && n != null && n > 1,
                  })
                }}
              />
            </FormField>
          )}

          {draft.offering_role === 'addon' && (
            <FormField label="Attaches to (parent offerings)">
              <div className="flex flex-col gap-1">
                {parentOptions.map((p) => {
                  const checked = (draft.attaches_to_offering_ids ?? []).includes(p.id)
                  return (
                    <label key={p.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = new Set(draft.attaches_to_offering_ids ?? [])
                          if (e.target.checked) next.add(p.id)
                          else next.delete(p.id)
                          setDraft({ ...draft, attaches_to_offering_ids: Array.from(next) })
                        }}
                        className="rounded border-border accent-accent"
                      />
                      {p.name}
                    </label>
                  )
                })}
                {parentOptions.length === 0 && (
                  <p className="text-xs text-fg-subtle italic">No parent offerings yet.</p>
                )}
              </div>
            </FormField>
          )}

          {draft.offering_role === 'addon' && draft.uses_cohort_rotation && (
            <div className="rounded-md border border-border bg-surface-subtle px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wider text-fg-subtle mb-2">Cohort rotation</p>
              {cohort && cohort.cohorts.length > 0 ? (
                <ul className="space-y-1 text-xs">
                  {cohort.cohorts.map((c) => (
                    <li key={c.cohort_index} className="font-tabular">
                      Cohort {c.cohort_index} (next due {c.next_due_year}): {c.property_count} properties
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-fg-muted">
                  No cohort assignments yet. Will be auto-assigned when you save (or when a template is generated).
                </p>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={autoAssign}
                loading={rebalancing}
                className="mt-2"
              >
                Re-balance assignments
              </Button>
            </div>
          )}

          {error && <p className="text-xs text-danger">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
