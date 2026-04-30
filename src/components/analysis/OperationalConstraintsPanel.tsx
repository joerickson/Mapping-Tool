import { useEffect, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import Button from '../ui/Button'
import { Badge } from '../ui/Badge'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog'
import { FormField, Input } from '../ui/Input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/Select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/Tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/Table'
import { cn } from '../../lib/cn'

export interface ExistingBranch {
  name: string
  address?: string | null
  lat: number
  lng: number
  locked?: boolean
}

export interface OperationalConstraints {
  account_id: string
  client_id: string | null
  existing_branches: ExistingBranch[]
  excluded_property_ids: string[]
  excluded_property_reason: string | null

  crew_size: number
  hours_per_day: number
  hourly_loaded_labor_cost: number
  project_clean_base_hours: number
  project_clean_hours_per_sqft: number
  upholstery_solo_hours: number
  upholstery_combo_hours_pct: number
  recurring_productivity_sqft_per_hour: number
  fuel_cost_per_mile: number
  vehicles_per_crew: number
  surge_weeks_per_year: number
  surge_crew_count: number
  surge_premium_multiplier: number
  branch_overhead_annual: number
  hotels_annual: number
  vehicle_lease_annual_per_crew: number
  supplies_pct_of_labor: number
  insurance_annual: number
  corporate_overhead_pct: number
  target_gross_margin_pct: number
  drive_speed_mph: number
  max_one_way_drive_minutes: number

  population_constraint: {
    enabled: boolean
    min_population: number
    max_population?: number | null
    state_filter?: string[] | null
  }
  utilization_constraint: {
    enabled: boolean
    hard_floor_pct: number
    soft_ceiling_pct: number
    ideal_min_pct: number
    ideal_max_pct: number
    scope: 'per_branch' | 'per_region' | 'portfolio'
  }

  updated_at: string | null
  updated_by: string | null
  has_saved_row: boolean
  system_defaults: Record<string, number>
}

interface PropertyOption {
  id: string
  address_line1: string
  city: string
  state: string
}

interface Props {
  accountId: string
  clientId: string
  onSaved?: (saved: OperationalConstraints) => void
  onUpdatedAtChange?: (iso: string | null) => void
}

const NUMERIC_FIELD_GROUPS = {
  crew_economics: [
    'crew_size',
    'hours_per_day',
    'hourly_loaded_labor_cost',
    'project_clean_base_hours',
    'project_clean_hours_per_sqft',
    'upholstery_solo_hours',
    'upholstery_combo_hours_pct',
    'recurring_productivity_sqft_per_hour',
    'fuel_cost_per_mile',
    'vehicles_per_crew',
  ] as const,
  cost_margin: [
    'surge_weeks_per_year',
    'surge_crew_count',
    'surge_premium_multiplier',
    'branch_overhead_annual',
    'hotels_annual',
    'vehicle_lease_annual_per_crew',
    'supplies_pct_of_labor',
    'insurance_annual',
    'corporate_overhead_pct',
    'target_gross_margin_pct',
    'drive_speed_mph',
    'max_one_way_drive_minutes',
  ] as const,
}

const FIELD_LABELS: Record<string, string> = {
  crew_size: 'Crew size (workers)',
  hours_per_day: 'Hours per day',
  hourly_loaded_labor_cost: 'Hourly loaded labor cost ($)',
  project_clean_base_hours: 'Project clean base hours',
  project_clean_hours_per_sqft: 'Project clean hours per sqft',
  upholstery_solo_hours: 'Upholstery solo hours',
  upholstery_combo_hours_pct: 'Upholstery combo % of project clean',
  recurring_productivity_sqft_per_hour: 'Recurring productivity (sqft/hour)',
  fuel_cost_per_mile: 'Fuel cost per mile ($)',
  vehicles_per_crew: 'Vehicles per crew',
  surge_weeks_per_year: 'Surge weeks per year',
  surge_crew_count: 'Surge crew count',
  surge_premium_multiplier: 'Surge premium multiplier',
  branch_overhead_annual: 'Branch overhead ($/year)',
  hotels_annual: 'Hotels ($/year)',
  vehicle_lease_annual_per_crew: 'Vehicle lease ($/crew/year)',
  supplies_pct_of_labor: 'Supplies (% of labor)',
  insurance_annual: 'Insurance ($/year)',
  corporate_overhead_pct: 'Corporate overhead (%)',
  target_gross_margin_pct: 'Target gross margin (%)',
  drive_speed_mph: 'Drive speed (mph)',
  max_one_way_drive_minutes: 'Max one-way drive (min)',
}

export default function OperationalConstraintsPanel({
  accountId,
  clientId,
  onSaved,
  onUpdatedAtChange,
}: Props) {
  const { getToken } = useAuth()
  const [data, setData] = useState<OperationalConstraints | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)

  const loadConstraints = async () => {
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(
        `/api/accounts/${accountId}/clients/${clientId}/operational-constraints`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: OperationalConstraints = await res.json()
      setData(json)
      onUpdatedAtChange?.(json.updated_at)
    } catch (err: any) {
      setError(err?.message ?? String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadConstraints()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, clientId])

  const overriddenCount = data ? countOverriddenFields(data) : 0
  const branchCount = data?.existing_branches.length ?? 0
  const excludedCount = data?.excluded_property_ids.length ?? 0

  return (
    <>
      <div className="rounded-lg border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="text-base font-semibold tracking-tight text-fg">
              Operational constraints
            </h3>
            <div className="text-sm text-fg-muted">
              {loading ? (
                'Loading…'
              ) : error ? (
                <span className="text-danger">Failed to load: {error}</span>
              ) : (
                <span>
                  <span className="font-tabular">{branchCount}</span> existing
                  branch{branchCount === 1 ? '' : 'es'} ·{' '}
                  <span className="font-tabular">{excludedCount}</span>{' '}
                  propert{excludedCount === 1 ? 'y' : 'ies'} excluded ·{' '}
                  <span className="font-tabular">{overriddenCount}</span>{' '}
                  override{overriddenCount === 1 ? '' : 's'}
                  {data?.updated_at && (
                    <span className="text-fg-subtle">
                      {' · saved '}
                      <span className="font-tabular">
                        {new Date(data.updated_at).toLocaleString()}
                      </span>
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setEditorOpen(true)}
            disabled={loading}
          >
            Edit constraints
          </Button>
        </div>
      </div>

      {data && (
        <ConstraintsEditor
          accountId={accountId}
          clientId={clientId}
          open={editorOpen}
          onOpenChange={setEditorOpen}
          constraints={data}
          onSaved={(saved) => {
            setData(saved)
            onUpdatedAtChange?.(saved.updated_at)
            onSaved?.(saved)
          }}
        />
      )}
    </>
  )
}

function countOverriddenFields(c: OperationalConstraints): number {
  if (!c.has_saved_row) return 0
  let n = 0
  for (const k of Object.keys(c.system_defaults ?? {})) {
    const def = (c.system_defaults as any)[k]
    const cur = (c as any)[k]
    if (def != null && cur != null && Math.abs(def - cur) > 1e-9) n += 1
  }
  return n
}

// ─────────────────────────────────────────────────────────────────────────────
// Editor dialog — three tabs
// ─────────────────────────────────────────────────────────────────────────────

interface EditorProps {
  accountId: string
  clientId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  constraints: OperationalConstraints
  onSaved: (saved: OperationalConstraints) => void
}

type TabKey = 'infrastructure' | 'crew_economics' | 'cost_margin'

function ConstraintsEditor({
  accountId,
  clientId,
  open,
  onOpenChange,
  constraints,
  onSaved,
}: EditorProps) {
  const { getToken } = useAuth()
  const [activeTab, setActiveTab] = useState<TabKey>('infrastructure')
  const [draft, setDraft] = useState<OperationalConstraints>(constraints)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [propertyOptions, setPropertyOptions] = useState<PropertyOption[]>([])

  useEffect(() => {
    if (open) {
      setDraft(constraints)
      setSaveMessage(null)
      setSaveError(null)
    }
  }, [open, constraints])

  // Lazy-load the account's properties (for the excluded-properties picker).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    async function loadProps() {
      try {
        const token = await getToken()
        const clientsRes = await fetch(`/api/v1/clients?account_id=${accountId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!clientsRes.ok) return
        const clients = (await clientsRes.json()) as Array<{ id: string }>
        if (!clients.length) return
        const propsRes = await fetch(
          `/api/v1/properties?client_id=${encodeURIComponent(
            clients.map((c) => c.id).join(',')
          )}&limit=2000`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (!propsRes.ok) return
        const json = await propsRes.json()
        if (cancelled) return
        const opts: PropertyOption[] = (json.properties ?? []).map((p: any) => ({
          id: p.property_id ?? p.id,
          address_line1: p.address_line1,
          city: p.city,
          state: p.state,
        }))
        opts.sort((a, b) =>
          `${a.state}|${a.city}|${a.address_line1}`.localeCompare(
            `${b.state}|${b.city}|${b.address_line1}`
          )
        )
        setPropertyOptions(opts)
      } catch {
        /* ignore */
      }
    }
    loadProps()
    return () => {
      cancelled = true
    }
  }, [open, accountId, clientId, getToken])

  const handleSave = async () => {
    setSaving(true)
    setSaveMessage(null)
    setSaveError(null)
    try {
      const token = await getToken()
      const payload: Record<string, unknown> = {
        client_id: draft.client_id,
        existing_branches: draft.existing_branches,
        excluded_property_ids: draft.excluded_property_ids,
        excluded_property_reason: draft.excluded_property_reason,
        population_constraint: draft.population_constraint,
        utilization_constraint: draft.utilization_constraint,
      }
      // Send numeric fields that differ from system default; null the rest.
      for (const k of Object.keys(constraints.system_defaults ?? {})) {
        const cur = (draft as any)[k]
        const def = (constraints.system_defaults as any)[k]
        if (cur == null || (def != null && Math.abs(def - cur) < 1e-9)) {
          payload[k] = null
        } else {
          payload[k] = cur
        }
      }

      const res = await fetch(
        `/api/accounts/${accountId}/clients/${clientId}/operational-constraints`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        }
      )
      const json = await res.json()
      if (!res.ok) {
        setSaveError(json.error ?? `HTTP ${res.status}`)
        return
      }
      setSaveMessage('Constraints saved. Re-run analyses to apply.')
      onSaved(json)
      setTimeout(() => onOpenChange(false), 900)
    } catch (err: any) {
      setSaveError(err?.message ?? String(err))
    } finally {
      setSaving(false)
    }
  }

  const updateNumeric = (k: string, v: string) => {
    if (v === '') {
      setDraft((d) => ({ ...d, [k]: (constraints.system_defaults as any)[k] ?? 0 }))
    } else {
      const n = parseFloat(v)
      if (Number.isFinite(n)) setDraft((d) => ({ ...d, [k]: n }))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Operational constraints</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
          <TabsList>
            <TabsTrigger value="infrastructure">Infrastructure</TabsTrigger>
            <TabsTrigger value="crew_economics">Crew economics</TabsTrigger>
            <TabsTrigger value="cost_margin">Cost &amp; margin</TabsTrigger>
          </TabsList>

          <TabsContent value="infrastructure" className="mt-6">
            <InfrastructureTab
              draft={draft}
              setDraft={setDraft}
              propertyOptions={propertyOptions}
            />
          </TabsContent>

          <TabsContent value="crew_economics" className="mt-6 space-y-8">
            <FieldGrid
              draft={draft}
              defaults={constraints.system_defaults}
              fields={NUMERIC_FIELD_GROUPS.crew_economics as unknown as string[]}
              onChange={updateNumeric}
            />
            <UtilizationBandSubsection draft={draft} setDraft={setDraft} />
          </TabsContent>

          <TabsContent value="cost_margin" className="mt-6">
            <FieldGrid
              draft={draft}
              defaults={constraints.system_defaults}
              fields={NUMERIC_FIELD_GROUPS.cost_margin as unknown as string[]}
              onChange={updateNumeric}
            />
          </TabsContent>
        </Tabs>

        {(saveError || saveMessage) && (
          <div className="text-sm">
            {saveError && (
              <p className="rounded-md border border-danger/20 bg-danger-subtle px-3 py-2 text-danger">
                {saveError}
              </p>
            )}
            {saveMessage && (
              <p className="rounded-md border border-success/20 bg-success-subtle px-3 py-2 text-success">
                {saveMessage}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" size="sm" disabled={saving}>
              Cancel
            </Button>
          </DialogClose>
          <Button size="sm" onClick={handleSave} loading={saving} disabled={saving}>
            Save constraints
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Infrastructure
// ─────────────────────────────────────────────────────────────────────────────

function InfrastructureTab({
  draft,
  setDraft,
  propertyOptions,
}: {
  draft: OperationalConstraints
  setDraft: React.Dispatch<React.SetStateAction<OperationalConstraints>>
  propertyOptions: PropertyOption[]
}) {
  const [newBranchName, setNewBranchName] = useState('')
  const [newBranchAddress, setNewBranchAddress] = useState('')

  const addBranch = () => {
    if (!newBranchName.trim() || !newBranchAddress.trim()) return
    setDraft((d) => ({
      ...d,
      existing_branches: [
        ...d.existing_branches,
        {
          name: newBranchName.trim(),
          address: newBranchAddress.trim(),
          lat: 0,
          lng: 0,
          locked: true,
        },
      ],
    }))
    setNewBranchName('')
    setNewBranchAddress('')
  }

  const removeBranch = (idx: number) => {
    setDraft((d) => ({
      ...d,
      existing_branches: d.existing_branches.filter((_, i) => i !== idx),
    }))
  }

  const toggleLocked = (idx: number) => {
    setDraft((d) => ({
      ...d,
      existing_branches: d.existing_branches.map((b, i) =>
        i === idx ? { ...b, locked: b.locked === false } : b
      ),
    }))
  }

  const addExclusion = (id: string) => {
    if (!id || draft.excluded_property_ids.includes(id)) return
    setDraft((d) => ({
      ...d,
      excluded_property_ids: [...d.excluded_property_ids, id],
    }))
  }

  const removeExclusion = (id: string) => {
    setDraft((d) => ({
      ...d,
      excluded_property_ids: d.excluded_property_ids.filter((x) => x !== id),
    }))
  }

  const propertyById = new Map(propertyOptions.map((p) => [p.id, p]))
  const availableForExclusion = propertyOptions.filter(
    (p) => !draft.excluded_property_ids.includes(p.id)
  )

  return (
    <div className="space-y-8">
      {/* Existing Branches */}
      <section className="space-y-3">
        <div>
          <h4 className="text-sm font-semibold text-fg">Existing branches</h4>
          <p className="mt-1 text-xs text-fg-muted">
            Branches that are already operational. They get locked as cluster
            centroids in Branch Optimization — k-means picks{' '}
            <em>additional</em> branches around them but never moves them.
          </p>
        </div>

        {draft.existing_branches.length > 0 && (
          <div className="rounded-md border border-border bg-surface overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Lat / Lng</TableHead>
                  <TableHead>Locked</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {draft.existing_branches.map((b, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium text-fg">{b.name}</TableCell>
                    <TableCell className="text-fg-muted">{b.address ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs text-fg-subtle">
                      {b.lat && b.lng
                        ? `${b.lat.toFixed(4)}, ${b.lng.toFixed(4)}`
                        : 'pending geocode'}
                    </TableCell>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={b.locked !== false}
                        onChange={() => toggleLocked(i)}
                        className="accent-accent"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <button
                        type="button"
                        onClick={() => removeBranch(i)}
                        className="rounded-sm text-xs text-danger hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        Remove
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto]">
          <Input
            type="text"
            placeholder="Branch name (e.g. Frisco TX)"
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
          />
          <Input
            type="text"
            placeholder="Address (e.g. 123 Main St, Frisco, TX 75034)"
            value={newBranchAddress}
            onChange={(e) => setNewBranchAddress(e.target.value)}
          />
          <Button
            size="sm"
            onClick={addBranch}
            disabled={!newBranchName.trim() || !newBranchAddress.trim()}
          >
            + Add branch
          </Button>
        </div>
        <p className="text-xs text-fg-subtle">
          Coordinates are looked up via Google Geocoding when you save.
        </p>
      </section>

      {/* Excluded Properties */}
      <section className="space-y-3 border-t border-border pt-6">
        <div>
          <h4 className="text-sm font-semibold text-fg">Excluded properties</h4>
          <p className="mt-1 text-xs text-fg-muted">
            Properties that are already covered by other crews and should be
            filtered out of every analysis. They still exist in the portfolio
            but won't appear in branch optimization, crew strategy, drive time,
            etc.
          </p>
        </div>

        {draft.excluded_property_ids.length > 0 && (
          <ul className="space-y-1.5">
            {draft.excluded_property_ids.map((id) => {
              const p = propertyById.get(id)
              return (
                <li
                  key={id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    {p ? (
                      <>
                        <p className="truncate font-medium text-fg">
                          {p.address_line1}
                        </p>
                        <p className="text-xs text-fg-muted">
                          {p.city}, {p.state} ·{' '}
                          <span className="font-mono">{id.slice(0, 8)}</span>
                        </p>
                      </>
                    ) : (
                      <p className="font-mono text-xs text-fg-muted">{id}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeExclusion(id)}
                    className="rounded-sm text-xs text-danger hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Remove
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <div className="space-y-2">
          <Select onValueChange={(v) => v && addExclusion(v)} value="">
            <SelectTrigger>
              <SelectValue placeholder="+ Add property to exclude…" />
            </SelectTrigger>
            <SelectContent>
              {availableForExclusion.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.address_line1}, {p.city}, {p.state}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            type="text"
            placeholder="Reason for exclusion (e.g. Already served by UT/AZ/NV crews)"
            value={draft.excluded_property_reason ?? ''}
            onChange={(e) =>
              setDraft((d) => ({ ...d, excluded_property_reason: e.target.value }))
            }
          />
        </div>
      </section>

      <PopulationConstraintSubsection draft={draft} setDraft={setDraft} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Population constraint subsection — Infrastructure tab
// ─────────────────────────────────────────────────────────────────────────────

function PopulationConstraintSubsection({
  draft,
  setDraft,
}: {
  draft: OperationalConstraints
  setDraft: React.Dispatch<React.SetStateAction<OperationalConstraints>>
}) {
  const pc = draft.population_constraint
  const update = (patch: Partial<OperationalConstraints['population_constraint']>) =>
    setDraft((d) => ({
      ...d,
      population_constraint: { ...d.population_constraint, ...patch },
    }))

  return (
    <section className="space-y-3 border-t border-border pt-6">
      <div>
        <h4 className="text-sm font-semibold text-fg">
          Population constraint for branch siting
        </h4>
        <p className="mt-1 text-xs text-fg-muted">
          Branch optimization will only suggest locations in cities meeting these
          criteria. Smaller cities may produce lower drive cost but make hiring
          difficult.
        </p>
      </div>

      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={pc.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
          className="accent-accent"
        />
        <span className="text-sm font-medium text-fg">
          Restrict branch suggestions to cities above population threshold
        </span>
      </label>

      {pc.enabled && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Minimum population" htmlFor="min-pop" helper="Default 50,000">
            <Input
              id="min-pop"
              type="number"
              min={1000}
              max={5_000_000}
              step={5000}
              value={pc.min_population}
              onChange={(e) =>
                update({ min_population: Number(e.target.value) || 50000 })
              }
            />
          </FormField>
          <FormField label="Maximum population" htmlFor="max-pop" helper="Optional">
            <Input
              id="max-pop"
              type="number"
              min={1000}
              step={50000}
              value={pc.max_population ?? ''}
              placeholder="No max"
              onChange={(e) =>
                update({
                  max_population: e.target.value === '' ? null : Number(e.target.value),
                })
              }
            />
          </FormField>
          <FormField
            label="Restrict to states"
            htmlFor="state-filter"
            helper="Optional, comma-separated 2-letter codes"
            className="sm:col-span-2"
          >
            <Input
              id="state-filter"
              type="text"
              placeholder="e.g. TX, NM, OK, AZ"
              value={(pc.state_filter ?? []).join(', ')}
              onChange={(e) =>
                update({
                  state_filter:
                    e.target.value.trim() === ''
                      ? null
                      : e.target.value
                          .split(',')
                          .map((s) => s.trim().toUpperCase())
                          .filter((s) => /^[A-Z]{2}$/.test(s)),
                })
              }
            />
          </FormField>
        </div>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilization band subsection — Crew Economics tab
// ─────────────────────────────────────────────────────────────────────────────

function UtilizationBandSubsection({
  draft,
  setDraft,
}: {
  draft: OperationalConstraints
  setDraft: React.Dispatch<React.SetStateAction<OperationalConstraints>>
}) {
  const u = draft.utilization_constraint
  const update = (patch: Partial<OperationalConstraints['utilization_constraint']>) =>
    setDraft((d) => ({
      ...d,
      utilization_constraint: { ...d.utilization_constraint, ...patch },
    }))

  const valid =
    u.hard_floor_pct < u.ideal_min_pct &&
    u.ideal_min_pct < u.ideal_max_pct &&
    u.ideal_max_pct < u.soft_ceiling_pct

  return (
    <section className="space-y-3 border-t border-border pt-6">
      <h4 className="text-sm font-semibold text-fg">Utilization band</h4>

      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={u.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
          className="accent-accent"
        />
        <span className="text-sm font-medium text-fg">
          Enforce utilization band on crew sizing
        </span>
      </label>

      {u.enabled && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <PercentField
              label="Hard floor"
              value={u.hard_floor_pct}
              onChange={(v) => update({ hard_floor_pct: v })}
            />
            <PercentField
              label="Ideal min"
              value={u.ideal_min_pct}
              onChange={(v) => update({ ideal_min_pct: v })}
            />
            <PercentField
              label="Ideal max"
              value={u.ideal_max_pct}
              onChange={(v) => update({ ideal_max_pct: v })}
            />
            <PercentField
              label="Soft ceiling"
              value={u.soft_ceiling_pct}
              onChange={(v) => update({ soft_ceiling_pct: v })}
            />
          </div>

          <UtilizationBandViz band={u} />
          {!valid && (
            <p className="text-xs text-danger">
              Invalid band: must be hard_floor &lt; ideal_min &lt; ideal_max &lt;
              soft_ceiling.
            </p>
          )}

          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              Constraint scope
            </p>
            <div className="flex flex-wrap gap-3 text-sm">
              {(['per_branch', 'per_region', 'portfolio'] as const).map((s) => (
                <label key={s} className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    checked={u.scope === s}
                    onChange={() => update({ scope: s })}
                    className="accent-accent"
                  />
                  <span className="capitalize text-fg">{s.replace('_', '-')}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-fg-muted">
              Per-branch is most conservative — surfaces if any individual branch
              is over- or under-utilized. Portfolio is most permissive. Solutions
              outside the band are still shown but flagged.
            </p>
          </div>
        </>
      )}
    </section>
  )
}

function PercentField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <FormField label={label}>
      <div className="relative">
        <Input
          type="number"
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n)) onChange(n)
          }}
          className="pr-7"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-fg-subtle">
          %
        </span>
      </div>
    </FormField>
  )
}

function UtilizationBandViz({
  band,
}: {
  band: {
    hard_floor_pct: number
    soft_ceiling_pct: number
    ideal_min_pct: number
    ideal_max_pct: number
  }
}) {
  const max = 130
  // Use semantic-subtle backgrounds via inline styles so the bands stay
  // legible regardless of theme. (Token-driven equivalents would require
  // an extra render trip on theme change for the same hand-picked palette.)
  const seg = (from: number, to: number, color: string, key: string) => {
    const left = (Math.max(0, from) / max) * 100
    const width = (Math.max(0, to - from) / max) * 100
    return (
      <div
        key={key}
        className="absolute top-0 bottom-0"
        style={{ left: `${left}%`, width: `${width}%`, background: color }}
      />
    )
  }
  return (
    <div>
      <div className="relative h-4 overflow-hidden rounded bg-surface-muted">
        {seg(0, band.hard_floor_pct, 'rgb(254 202 202)', 'low')}
        {seg(band.hard_floor_pct, band.ideal_min_pct, 'rgb(253 230 138)', 'lowmid')}
        {seg(band.ideal_min_pct, band.ideal_max_pct, 'rgb(187 247 208)', 'ideal')}
        {seg(band.ideal_max_pct, band.soft_ceiling_pct, 'rgb(253 230 138)', 'highmid')}
        {seg(band.soft_ceiling_pct, max, 'rgb(254 202 202)', 'high')}
      </div>
      <div className="mt-0.5 flex justify-between font-mono text-[10px] text-fg-subtle">
        <span>0%</span>
        <span className="font-tabular">{band.hard_floor_pct}%</span>
        <span className="font-tabular">{band.ideal_min_pct}%</span>
        <span className="font-tabular">{band.ideal_max_pct}%</span>
        <span className="font-tabular">{band.soft_ceiling_pct}%</span>
        <span>{max}%</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Numeric field grid (Crew Economics + Cost & Margin tabs)
// ─────────────────────────────────────────────────────────────────────────────

function FieldGrid({
  draft,
  defaults,
  fields,
  onChange,
}: {
  draft: OperationalConstraints
  defaults: Record<string, number>
  fields: string[]
  onChange: (key: string, value: string) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields.map((k) => {
        const cur = (draft as any)[k] as number
        const def = defaults?.[k]
        const isOverridden = def != null && cur != null && Math.abs(def - cur) > 1e-9
        return (
          <FormField
            key={k}
            label={
              <span className="inline-flex items-center gap-1.5">
                {FIELD_LABELS[k] ?? k}
                {isOverridden && <Badge variant="accent">overridden</Badge>}
              </span>
            }
            htmlFor={`oc-${k}`}
            helper={def != null ? <>System default: <span className="font-tabular">{def}</span></> : undefined}
          >
            <Input
              id={`oc-${k}`}
              type="number"
              step="any"
              value={cur ?? ''}
              placeholder={def?.toString() ?? ''}
              onChange={(e) => onChange(k, e.target.value)}
              className={cn(isOverridden && 'border-accent/40')}
            />
          </FormField>
        )
      })}
    </div>
  )
}
