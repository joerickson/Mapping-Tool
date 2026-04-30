// Phase 4d — Template detail page.
// Header summary, generate-cycle action, cycle instances list, basic
// trip/crew tabs. Map + rich Gantt deferred to 4f.
import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Plus, Play, RefreshCw, Trash2 } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import AppShell from '../../../components/layout/AppShell'
import Button from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { Card, CardTitle } from '../../../components/ui/Card'
import { Input, FormField } from '../../../components/ui/Input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../../../components/ui/Dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../../components/ui/Table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../../components/ui/Tabs'

interface Template {
  id: string
  name: string
  description: string | null
  status: string
  crew_count: number
  is_custom_cycle_length: boolean
  cycle_length_days: number
  cycle_length_label: string
  total_visits_per_cycle: number | null
  total_visits_required_per_cycle: number | null
  total_drive_minutes_per_cycle: number | null
  total_work_minutes_per_cycle: number | null
  total_overnight_nights_per_cycle: number | null
  total_drive_miles_per_cycle: number | null
  total_estimated_cost_per_cycle: number | null
  total_estimated_cost_per_year: number | null
  hard_constraint_violations: number | null
  soft_constraint_violations: number | null
  optimization_score: number | null
  optimizer_notes: string | null
  geographic_clusters: any[]
  crew_assignments: any[]
  trips: any[]
  unplaced_visits: any[]
}

interface Cycle {
  id: string
  cycle_number: number
  start_date: string
  end_date: string
  status: string
}

export default function TemplateDetailPage() {
  const { accountId, clientId, templateId } = useParams<{
    accountId: string; clientId: string; templateId: string
  }>()
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const [template, setTemplate] = useState<Template | null>(null)
  const [cycles, setCycles] = useState<Cycle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [genStartDate, setGenStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [generating, setGenerating] = useState(false)
  const [regenOpen, setRegenOpen] = useState(false)
  const [regenCrewCount, setRegenCrewCount] = useState<number>(1)
  const [regenCycleDays, setRegenCycleDays] = useState<number | ''>('')
  const [regenObjective, setRegenObjective] = useState<'minimize_drive' | 'maximize_utilization' | 'balanced'>('balanced')
  const [regenerating, setRegenerating] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [recommendedCrew, setRecommendedCrew] = useState<{
    count: number
    option: string
  } | null>(null)

  const load = useCallback(async () => {
    if (!templateId) return
    setLoading(true)
    try {
      const token = await getToken()
      const [tplRes, cyRes] = await Promise.all([
        fetch(`/api/scheduler/templates/${templateId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/scheduler/cycles?template_id=${templateId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ])
      if (!tplRes.ok) throw new Error(`Template load failed (${tplRes.status})`)
      const tplData = await tplRes.json()
      setTemplate(tplData.template)
      if (cyRes.ok) {
        const cy = await cyRes.json()
        setCycles(cy.cycles ?? [])
      }
      // Pull crew_strategy recommendation for the regenerate dialog hint.
      if (accountId && clientId) {
        const latestRes = await fetch(
          `/api/analyses/account/${accountId}/clients/${clientId}/latest`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (latestRes.ok) {
          const rows = await latestRes.json()
          const cs = (rows as any[]).find(
            (r) => r.module_key === 'crew_strategy' && r.status === 'completed'
          )
          if (cs?.outputs) {
            const opt = cs.outputs.recommended_option as string | undefined
            const count = opt
              ? (cs.outputs.options?.[opt]?.crew_count as number | undefined)
              : undefined
            if (count != null) setRecommendedCrew({ count, option: opt ?? '?' })
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [accountId, clientId, templateId, getToken])

  useEffect(() => { load() }, [load])

  // Seed regen dialog defaults from current template values when opened
  useEffect(() => {
    if (template) {
      setRegenCrewCount(template.crew_count)
      setRegenCycleDays(template.is_custom_cycle_length ? template.cycle_length_days : '')
    }
  }, [template])

  async function handleRegenerate() {
    if (!templateId) return
    setRegenerating(true)
    setError(null)
    try {
      const token = await getToken()
      const body: Record<string, unknown> = {
        crew_count: regenCrewCount,
        preferences: { objective: regenObjective },
      }
      if (regenCycleDays !== '' && Number.isFinite(regenCycleDays)) {
        body.custom_cycle_length_days = regenCycleDays
      } else {
        body.custom_cycle_length_days = null
      }
      const res = await fetch(`/api/scheduler/templates/${templateId}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error ?? `Regenerate failed (${res.status})`)
      }
      setRegenOpen(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRegenerating(false)
    }
  }

  async function handleArchive() {
    if (!templateId) return
    if (!confirm('Archive this template? Cycles already generated stay; the template won\'t show in the active list.')) return
    setArchiving(true)
    try {
      const token = await getToken()
      const res = await fetch(`/api/scheduler/templates/${templateId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Archive failed (${res.status})`)
      }
      navigate(`/accounts/${accountId}/clients/${clientId}/scheduler/templates`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setArchiving(false)
    }
  }

  async function handleGenerate() {
    if (!templateId) return
    setGenerating(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/scheduler/templates/${templateId}/generate-cycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ start_date: genStartDate }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `Generate failed (${res.status})`)
      setGenerateOpen(false)
      await load()
      navigate(`/accounts/${accountId}/clients/${clientId}/scheduler/cycles/${body.cycle_instance_id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setGenerating(false)
    }
  }

  if (loading || !template) {
    return (
      <AppShell>
        <div className="mx-auto max-w-6xl px-6 py-10">
          <p className="text-sm text-fg-muted">{loading ? 'Loading…' : error ?? 'Template not found.'}</p>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell breadcrumb={[
      { label: 'Accounts', to: '/accounts' },
      { label: 'Routing templates', to: `/accounts/${accountId}/clients/${clientId}/scheduler/templates` },
      { label: template.name },
    ]}>
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold tracking-tight text-fg">{template.name}</h1>
              <Badge variant={template.status === 'active' ? 'success' : template.status === 'failed' ? 'danger' : 'outline'}>
                {template.status}
              </Badge>
            </div>
            <p className="text-sm text-fg-muted">
              {template.cycle_length_label} cycle · {template.crew_count} crews ·{' '}
              {template.total_visits_per_cycle ?? 0} visits/cycle ·{' '}
              ${(template.total_estimated_cost_per_year ?? 0).toLocaleString()} estimated annual cost
            </p>
            {template.description && <p className="text-sm text-fg-subtle">{template.description}</p>}
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => setGenerateOpen(true)} disabled={template.status !== 'active'}>
              <Play className="h-3.5 w-3.5" />
              Generate cycle
            </Button>
            <Button variant="secondary" onClick={() => setRegenOpen(true)}>
              <RefreshCw className="h-3.5 w-3.5" />
              Regenerate
            </Button>
            {template.status !== 'archived' && (
              <Button variant="ghost" onClick={handleArchive} loading={archiving}>
                <Trash2 className="h-3.5 w-3.5" />
                Archive
              </Button>
            )}
          </div>
        </header>

        {error && <p className="text-sm text-danger">{error}</p>}

        {/* Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat
            label="Drive"
            value={`${formatMin(template.total_drive_minutes_per_cycle ?? 0)} · ${Math.round(template.total_drive_miles_per_cycle ?? 0)} mi`}
          />
          <Stat
            label="Work"
            value={formatMin(template.total_work_minutes_per_cycle ?? 0)}
          />
          <Stat
            label="Overnights"
            value={`${template.total_overnight_nights_per_cycle ?? 0} nights`}
          />
          <Stat
            label="Score"
            value={`${template.optimization_score ?? 0}/100`}
            sub={`${template.hard_constraint_violations ?? 0} hard · ${template.soft_constraint_violations ?? 0} soft`}
          />
        </div>

        {template.optimizer_notes && (
          <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-fg">
            {template.optimizer_notes}
          </div>
        )}

        {/* Cycle instances */}
        <Card padding="none">
          <div className="border-b border-border px-4 py-3 flex items-center justify-between">
            <CardTitle>Cycle instances</CardTitle>
            <Button size="sm" variant="secondary" onClick={() => setGenerateOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              Generate next cycle
            </Button>
          </div>
          {cycles.length === 0 ? (
            <p className="px-4 py-6 text-sm text-fg-muted">No cycle instances yet. Generate one above.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cycle</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {cycles.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell numeric>{c.cycle_number}</TableCell>
                    <TableCell className="font-tabular text-xs">{c.start_date}</TableCell>
                    <TableCell className="font-tabular text-xs">{c.end_date}</TableCell>
                    <TableCell>
                      <Badge variant={c.status === 'completed' ? 'success' : c.status === 'in_progress' ? 'accent' : 'outline'}>
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/accounts/${accountId}/clients/${clientId}/scheduler/cycles/${c.id}`}
                        className="text-xs text-accent hover:underline"
                      >
                        View
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        {/* Tabs: Trips / Crews / Clusters / Unplaced */}
        <Tabs defaultValue="trips">
          <TabsList>
            <TabsTrigger value="trips">Trips ({template.trips?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="crews">Crews</TabsTrigger>
            <TabsTrigger value="clusters">Clusters</TabsTrigger>
            <TabsTrigger value="unplaced">
              Unplaced ({template.unplaced_visits?.length ?? 0})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="trips">
            <Card padding="none">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Trip</TableHead>
                    <TableHead>Crew</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Cluster</TableHead>
                    <TableHead>Starts on day</TableHead>
                    <TableHead>Trip length</TableHead>
                    <TableHead>Stops</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(template.trips ?? []).map((t: any) => (
                    <TableRow key={t.trip_id}>
                      <TableCell className="text-sm">
                        <div>{t.trip_label ?? t.trip_id}</div>
                        {t.trip_type === 'overnight' && t.start_location?.name && (
                          <div className="text-[11px] text-fg-subtle">
                            out of {t.start_location.name}
                          </div>
                        )}
                      </TableCell>
                      <TableCell numeric>{t.crew_index + 1}</TableCell>
                      <TableCell>
                        <Badge variant={t.trip_type === 'overnight' ? 'warning' : 'outline'}>
                          {t.trip_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-fg-muted">{t.cluster_label ?? t.cluster_id}</TableCell>
                      <TableCell numeric>{t.relative_start_day}</TableCell>
                      <TableCell numeric>{t.duration_days}d</TableCell>
                      <TableCell numeric>
                        {(t.days ?? []).reduce((s: number, d: any) => s + (d.stops?.length ?? 0), 0)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          <TabsContent value="crews">
            <Card padding="none">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Crew</TableHead>
                    <TableHead>Clusters</TableHead>
                    <TableHead>Work hrs/cycle</TableHead>
                    <TableHead>Drive hrs/cycle</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(template.crew_assignments ?? []).map((c: any) => (
                    <TableRow key={c.crew_index}>
                      <TableCell>{c.crew_label}</TableCell>
                      <TableCell numeric>{(c.cluster_ids ?? []).length}</TableCell>
                      <TableCell numeric>{Math.round(c.total_work_hours)}</TableCell>
                      <TableCell numeric>{Math.round(c.total_drive_hours)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          <TabsContent value="clusters">
            <Card padding="none">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cluster</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Properties</TableHead>
                    <TableHead>Work hrs</TableHead>
                    <TableHead>Trips/cycle</TableHead>
                    <TableHead>Days/trip</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(template.geographic_clusters ?? []).map((c: any) => (
                    <TableRow key={c.cluster_id}>
                      <TableCell className="text-sm">{c.cluster_label ?? c.cluster_id}</TableCell>
                      <TableCell>
                        <Badge variant={c.cluster_type === 'remote' ? 'warning' : 'outline'}>
                          {c.cluster_type}
                        </Badge>
                      </TableCell>
                      <TableCell numeric>{c.property_count}</TableCell>
                      <TableCell numeric>{Math.round(c.total_work_hours)}</TableCell>
                      <TableCell numeric>{c.trips_per_cycle}</TableCell>
                      <TableCell numeric>{c.days_on_site_per_trip}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          <TabsContent value="unplaced">
            <Card padding="none">
              {(template.unplaced_visits ?? []).length === 0 ? (
                <p className="px-4 py-6 text-sm text-fg-muted">No unplaced visits — all required visits scheduled.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Address</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(template.unplaced_visits ?? []).map((u: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm">{u.address}</TableCell>
                        <TableCell className="text-xs text-fg-muted">
                          <Badge variant="outline">{u.reason}</Badge>{' '}
                          {u.detail}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={generateOpen} onOpenChange={(o) => { if (!o) setGenerateOpen(false) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate cycle instance</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <FormField label="Start date">
              <Input
                type="date"
                value={genStartDate}
                onChange={(e) => setGenStartDate(e.target.value)}
              />
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setGenerateOpen(false)}>Cancel</Button>
            <Button onClick={handleGenerate} loading={generating}>Generate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={regenOpen} onOpenChange={(o) => { if (!o) setRegenOpen(false) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate template</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-fg-muted">
              Re-runs the optimizer against the same property set with adjusted settings.
              Cycles already generated stay intact; future cycles will use the new structure.
            </p>
            <FormField
              label="Crew count"
              helper={
                recommendedCrew
                  ? regenCrewCount === recommendedCrew.count
                    ? `Recommended from Crew Strategy (Option ${recommendedCrew.option}).`
                    : `Crew Strategy recommends ${recommendedCrew.count} (Option ${recommendedCrew.option}).`
                  : undefined
              }
            >
              <Input
                type="number"
                min={1}
                max={20}
                value={regenCrewCount}
                onChange={(e) => setRegenCrewCount(Math.max(1, Number(e.target.value) || 1))}
              />
              {recommendedCrew && regenCrewCount !== recommendedCrew.count && (
                <button
                  type="button"
                  onClick={() => setRegenCrewCount(recommendedCrew.count)}
                  className="text-xs text-accent hover:underline mt-1 self-start"
                >
                  Use recommended ({recommendedCrew.count})
                </button>
              )}
            </FormField>
            <FormField
              label="Custom cycle length (days, optional)"
              helper="Leave blank to auto-compute from parent visit intervals."
            >
              <Input
                type="number"
                value={regenCycleDays === '' ? '' : String(regenCycleDays)}
                onChange={(e) => setRegenCycleDays(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="auto"
              />
            </FormField>
            <FormField label="Optimization objective">
              <select
                className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm"
                value={regenObjective}
                onChange={(e) => setRegenObjective(e.target.value as any)}
              >
                <option value="minimize_drive">Minimize drive</option>
                <option value="maximize_utilization">Maximize utilization</option>
                <option value="balanced">Balanced</option>
              </select>
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRegenOpen(false)}>Cancel</Button>
            <Button onClick={handleRegenerate} loading={regenerating}>Regenerate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-fg-subtle">{label}</p>
      <p className="font-mono text-base font-semibold tabular-nums text-fg leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-fg-muted font-tabular">{sub}</p>}
    </div>
  )
}

function formatMin(min: number): string {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}
