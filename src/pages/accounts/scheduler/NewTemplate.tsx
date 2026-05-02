// Phase 4d — Routing template creation form.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import AppShell from '../../../components/layout/AppShell'
import Button from '../../../components/ui/Button'
import { Card, CardTitle } from '../../../components/ui/Card'
import { Input, Textarea, FormField } from '../../../components/ui/Input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../../components/ui/Select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../../components/ui/Table'

interface SLRow {
  service_location_id: string
  display_name: string | null
  service_offering_id: string | null
  property: { property_id: string; address_line1: string; city: string | null; state: string | null } | null
  status: string
}

interface Offering {
  id: string
  name: string
  is_routed: boolean
  offering_role: string
  visit_interval_years: number | null
}

export default function NewTemplatePage() {
  const { accountId, clientId } = useParams<{ accountId: string; clientId: string }>()
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const [sls, setSLs] = useState<SLRow[]>([])
  const [offerings, setOfferings] = useState<Offering[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [crewCount, setCrewCount] = useState(2)
  const [combinedInfo, setCombinedInfo] = useState<{ memberCount: number; displayName: string } | null>(null)
  const [crewCountUserEdited, setCrewCountUserEdited] = useState(false)
  const [recommendedCrew, setRecommendedCrew] = useState<{
    count: number // conservative — what to default to
    optimistic: number | null
    option: string
    source: 'building_count' | 'option_count'
  } | null>(null)
  const [cycleStartYear, setCycleStartYear] = useState(new Date().getUTCFullYear())
  const [planningMode, setPlanningMode] = useState<'auto' | 'hybrid' | 'manual'>('auto')
  const [objective, setObjective] = useState<'minimize_drive' | 'maximize_utilization' | 'balanced'>('balanced')
  const [customCycleDays, setCustomCycleDays] = useState<number | ''>('')

  const load = useCallback(async () => {
    if (!clientId || !accountId) return
    setLoading(true)
    try {
      const token = await getToken()
      const [slRes, offRes, latestRes, cliRes] = await Promise.all([
        fetch(`/api/v1/service-locations?client_id=${clientId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/v1/service-offerings?client_id=${clientId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/analyses/account/${accountId}/clients/${clientId}/latest`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/v1/clients/${clientId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ])
      if (cliRes.ok) {
        const c = await cliRes.json()
        if (c.is_combined) {
          setCombinedInfo({
            memberCount: c.member_client_ids?.length ?? 0,
            displayName: c.display_name ?? c.name,
          })
        }
      }
      if (slRes.ok) setSLs(await slRes.json())
      if (offRes.ok) {
        const o = await offRes.json()
        setOfferings(Array.isArray(o) ? o : o.items ?? [])
      }
      if (latestRes.ok) {
        const rows = await latestRes.json()
        const cs = (rows as any[]).find((r) => r.module_key === 'crew_strategy' && r.status === 'completed')
        if (cs?.outputs) {
          // Phase 3.8 — prefer the new building-count math when present.
          const cca = cs.outputs.crew_count_analysis as
            | {
                conservative: { crews_needed: number }
                optimistic: { crews_needed: number }
              }
            | undefined
          const opt = cs.outputs.recommended_option as string | undefined
          const optionCount = opt
            ? (cs.outputs.options?.[opt]?.crew_count as number | undefined)
            : undefined
          if (cca) {
            const cons = cca.conservative.crews_needed
            const optimi = cca.optimistic.crews_needed
            setRecommendedCrew({
              count: cons,
              optimistic: optimi !== cons ? optimi : null,
              option: opt ?? '?',
              source: 'building_count',
            })
            if (!crewCountUserEdited) setCrewCount(cons)
          } else if (optionCount != null) {
            setRecommendedCrew({
              count: optionCount,
              optimistic: null,
              option: opt ?? '?',
              source: 'option_count',
            })
            if (!crewCountUserEdited) setCrewCount(optionCount)
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, clientId, getToken])

  useEffect(() => { load() }, [load])

  // Routed parent offerings only.
  const routedParentOfferingIds = useMemo(
    () => new Set(offerings.filter((o) => o.is_routed && o.offering_role === 'parent').map((o) => o.id)),
    [offerings]
  )

  const routedSLs = useMemo(
    () => sls.filter((sl) => sl.service_offering_id && routedParentOfferingIds.has(sl.service_offering_id)),
    [sls, routedParentOfferingIds]
  )
  const standaloneCount = sls.length - routedSLs.length

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return routedSLs
    return routedSLs.filter((sl) => {
      const hay = `${sl.display_name ?? ''} ${sl.property?.address_line1 ?? ''} ${sl.property?.city ?? ''} ${sl.property?.state ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [routedSLs, filter])

  const computedCycleLabel = useMemo(() => {
    if (typeof customCycleDays === 'number' && customCycleDays > 0) {
      return `${customCycleDays} days (custom)`
    }
    const intervals = new Set<number>()
    for (const sl of filtered) {
      const o = offerings.find((x) => x.id === sl.service_offering_id)
      if (o?.visit_interval_years != null) intervals.add(o.visit_interval_years)
    }
    if (intervals.size === 0) return '—'
    const minInterval = Math.min(...intervals)
    const days = Math.round(minInterval * 365)
    if (days >= 175 && days <= 188) return `6 months (${days} days)`
    if (days >= 85 && days <= 95) return `3 months (${days} days)`
    if (days >= 358 && days <= 372) return `12 months (${days} days)`
    return `${days} days`
  }, [filtered, offerings, customCycleDays])

  function toggleAllFiltered() {
    if (filtered.every((sl) => selected.has(sl.service_location_id))) {
      const next = new Set(selected)
      for (const sl of filtered) next.delete(sl.service_location_id)
      setSelected(next)
    } else {
      const next = new Set(selected)
      for (const sl of filtered) next.add(sl.service_location_id)
      setSelected(next)
    }
  }

  function toggleOne(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  async function handleGenerate() {
    if (!accountId || !clientId || selected.size === 0 || !name.trim()) return
    setCreating(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/scheduler/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          account_id: accountId,
          client_id: clientId,
          name: name.trim(),
          description: description.trim() || undefined,
          service_location_ids: Array.from(selected),
          crew_count: crewCount,
          cycle_start_year: cycleStartYear,
          planning_mode: planningMode,
          custom_cycle_length_days: typeof customCycleDays === 'number' ? customCycleDays : undefined,
          preferences: {
            objective,
            soft_constraint_weight: 0.5,
            allow_hard_constraint_violation: false,
          },
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `Generate failed (${res.status})`)
      navigate(`/accounts/${accountId}/clients/${clientId}/scheduler/templates/${body.template.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <AppShell breadcrumb={[
      { label: 'Accounts', to: '/accounts' },
      { label: 'Routing templates', to: `/accounts/${accountId}/clients/${clientId}/scheduler/templates` },
      { label: 'New' },
    ]}>
      <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">New routing template</h1>
        </header>

        {combinedInfo && (
          <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            <strong>Combined client.</strong> Properties listed below are unioned from{' '}
            {combinedInfo.memberCount} member clients. The template will be created with all
            members linked, and the engine will route across the whole portfolio. Branches and
            crew config come from this combined client's own settings — make sure you've
            synced from members or run Branch Optimization on it first.
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="space-y-4 lg:col-span-1">
            <CardTitle>Settings</CardTitle>
            <FormField label="Name" htmlFor="t-name">
              <Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField label="Description (optional)">
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </FormField>
            <FormField
              label="Crew count"
              helper={
                recommendedCrew
                  ? recommendedCrew.source === 'building_count'
                    ? recommendedCrew.optimistic != null
                      ? `Recommended: ${recommendedCrew.count} crews (conservative). ${recommendedCrew.optimistic} with small-property pairing.`
                      : `Recommended: ${recommendedCrew.count} crews from building-count math.`
                    : crewCount === recommendedCrew.count
                      ? `Recommended from Crew Strategy (Option ${recommendedCrew.option}).`
                      : `Crew Strategy recommends ${recommendedCrew.count} (Option ${recommendedCrew.option}).`
                  : 'Run Crew Strategy in Smart Analysis to get a recommendation.'
              }
            >
              <Input
                type="number"
                min={1}
                max={20}
                value={crewCount}
                onChange={(e) => {
                  setCrewCountUserEdited(true)
                  setCrewCount(Math.max(1, Number(e.target.value) || 1))
                }}
              />
              {recommendedCrew && crewCount !== recommendedCrew.count && (
                <button
                  type="button"
                  onClick={() => {
                    setCrewCountUserEdited(false)
                    setCrewCount(recommendedCrew.count)
                  }}
                  className="text-xs text-accent hover:underline mt-1 self-start"
                >
                  Use recommended ({recommendedCrew.count})
                </button>
              )}
            </FormField>
            <FormField label="Cycle start year">
              <Input
                type="number"
                value={cycleStartYear}
                onChange={(e) => setCycleStartYear(Number(e.target.value) || new Date().getUTCFullYear())}
              />
            </FormField>
            <FormField label="Cycle length (computed)" helper="Auto-derived from selected properties' parent intervals.">
              <p className="font-mono text-sm text-fg">{computedCycleLabel}</p>
            </FormField>
            <FormField label="Custom cycle length (days, optional)">
              <Input
                type="number"
                value={customCycleDays === '' ? '' : String(customCycleDays)}
                onChange={(e) => setCustomCycleDays(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="leave blank to auto-compute"
              />
            </FormField>
            <FormField label="Planning mode">
              <Select value={planningMode} onValueChange={(v) => setPlanningMode(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="hybrid">Hybrid</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Optimization objective">
              <Select value={objective} onValueChange={(v) => setObjective(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="minimize_drive">Minimize drive</SelectItem>
                  <SelectItem value="maximize_utilization">Maximize utilization</SelectItem>
                  <SelectItem value="balanced">Balanced</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <Button
              className="w-full"
              loading={creating}
              disabled={selected.size === 0 || !name.trim()}
              onClick={handleGenerate}
            >
              Generate template ({selected.size})
            </Button>
          </Card>

          <Card padding="none" className="lg:col-span-2 flex flex-col">
            <div className="border-b border-border px-4 py-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Routed properties</CardTitle>
                <span className="text-xs text-fg-muted">
                  {selected.size} selected · {routedSLs.length} routed
                  {standaloneCount > 0 && (
                    <span className="text-fg-subtle"> ({standaloneCount} standalone excluded)</span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-subtle" />
                  <Input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filter…"
                    className="pl-8"
                  />
                </div>
                <Button size="sm" variant="ghost" onClick={toggleAllFiltered}>
                  {filtered.every((sl) => selected.has(sl.service_location_id)) ? 'Deselect all' : 'Select all'}
                </Button>
              </div>
              {routedSLs.length === 0 && !loading && (
                <p className="text-xs text-fg-muted">
                  No routed properties found. <Link to={`/accounts/${accountId}/clients/${clientId}/admin/service-offerings`} className="text-accent hover:underline">
                    Configure offerings as routed
                  </Link> in service offerings settings first.
                </p>
              )}
            </div>
            <div className="max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Address</TableHead>
                    <TableHead>City / state</TableHead>
                    <TableHead>Offering</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((sl) => {
                    const offering = offerings.find((o) => o.id === sl.service_offering_id)
                    return (
                      <TableRow key={sl.service_location_id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selected.has(sl.service_location_id)}
                            onChange={() => toggleOne(sl.service_location_id)}
                            className="rounded border-border accent-accent"
                          />
                        </TableCell>
                        <TableCell className="text-sm">
                          {sl.display_name ?? sl.property?.address_line1}
                        </TableCell>
                        <TableCell className="text-xs text-fg-muted">
                          {sl.property?.city}{sl.property?.state ? `, ${sl.property.state}` : ''}
                        </TableCell>
                        <TableCell className="text-xs">{offering?.name ?? '—'}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  )
}
