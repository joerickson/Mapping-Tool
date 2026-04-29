import { useEffect, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import Button from '../ui/Button'
import Modal from '../ui/Modal'

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

export default function OperationalConstraintsPanel({ accountId, onSaved, onUpdatedAtChange }: Props) {
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
        `/api/accounts/${accountId}/operational-constraints`,
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
  }, [accountId])

  const overriddenCount = data
    ? countOverriddenFields(data)
    : 0
  const branchCount = data?.existing_branches.length ?? 0
  const excludedCount = data?.excluded_property_ids.length ?? 0

  return (
    <>
      <div className="bg-white rounded-xl border shadow-sm">
        <div className="px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-gray-900">Operational Constraints</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {loading ? (
                'Loading…'
              ) : error ? (
                <span className="text-red-600">Failed to load: {error}</span>
              ) : (
                <>
                  {branchCount} existing branch{branchCount === 1 ? '' : 'es'} configured ·{' '}
                  {excludedCount} propert{excludedCount === 1 ? 'y' : 'ies'} excluded ·{' '}
                  {overriddenCount} constraint{overriddenCount === 1 ? '' : 's'} overridden from defaults
                  {data?.updated_at && (
                    <span className="text-gray-400">
                      {' · saved '}
                      {new Date(data.updated_at).toLocaleString()}
                    </span>
                  )}
                </>
              )}
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setEditorOpen(true)} disabled={loading}>
            Edit Constraints
          </Button>
        </div>
      </div>

      {data && (
        <ConstraintsEditor
          accountId={accountId}
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
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
// Editor modal — three tabs
// ─────────────────────────────────────────────────────────────────────────────

interface EditorProps {
  accountId: string
  open: boolean
  onClose: () => void
  constraints: OperationalConstraints
  onSaved: (saved: OperationalConstraints) => void
}

type TabKey = 'infrastructure' | 'crew_economics' | 'cost_margin'

function ConstraintsEditor({ accountId, open, onClose, constraints, onSaved }: EditorProps) {
  const { getToken } = useAuth()
  const [activeTab, setActiveTab] = useState<TabKey>('infrastructure')
  const [draft, setDraft] = useState<OperationalConstraints>(constraints)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [propertyOptions, setPropertyOptions] = useState<PropertyOption[]>([])

  // Reset draft whenever the modal opens with fresh data.
  useEffect(() => {
    if (open) {
      setDraft(constraints)
      setSaveMessage(null)
      setSaveError(null)
    }
  }, [open, constraints])

  // Lazy-load the account's properties (for the excluded-properties picker)
  // when the modal opens.
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
  }, [open, accountId, getToken])

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
      // Only send numeric fields that differ from system default; let the
      // backend NULL the rest so they fall back to defaults.
      for (const k of Object.keys(constraints.system_defaults ?? {})) {
        const cur = (draft as any)[k]
        const def = (constraints.system_defaults as any)[k]
        if (cur == null || (def != null && Math.abs(def - cur) < 1e-9)) {
          payload[k] = null
        } else {
          payload[k] = cur
        }
      }

      const res = await fetch(`/api/accounts/${accountId}/operational-constraints`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) {
        setSaveError(json.error ?? `HTTP ${res.status}`)
        return
      }
      setSaveMessage('Constraints saved. Re-run analyses to apply.')
      onSaved(json)
      // Auto-close after a moment so the user sees the toast.
      setTimeout(() => {
        onClose()
      }, 900)
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
    <Modal open={open} onClose={onClose} title="Operational Constraints" size="xl">
      {/* Tabs */}
      <div className="flex gap-1 border-b mb-4">
        {(
          [
            ['infrastructure', 'Infrastructure'],
            ['crew_economics', 'Crew Economics'],
            ['cost_margin', 'Cost & Margin'],
          ] as Array<[TabKey, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              activeTab === key
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'infrastructure' && (
        <InfrastructureTab
          draft={draft}
          setDraft={setDraft}
          propertyOptions={propertyOptions}
        />
      )}

      {activeTab === 'crew_economics' && (
        <div className="space-y-6">
          <FieldGrid
            draft={draft}
            defaults={constraints.system_defaults}
            fields={NUMERIC_FIELD_GROUPS.crew_economics as unknown as string[]}
            onChange={updateNumeric}
          />
          <UtilizationBandSubsection draft={draft} setDraft={setDraft} />
        </div>
      )}

      {activeTab === 'cost_margin' && (
        <FieldGrid
          draft={draft}
          defaults={constraints.system_defaults}
          fields={NUMERIC_FIELD_GROUPS.cost_margin as unknown as string[]}
          onChange={updateNumeric}
        />
      )}

      {/* Footer */}
      <div className="border-t mt-5 pt-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm">
          {saveError && <span className="text-red-600">Error: {saveError}</span>}
          {saveMessage && <span className="text-green-700">{saveMessage}</span>}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} loading={saving} disabled={saving}>
            Save constraints
          </Button>
        </div>
      </div>
    </Modal>
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
  const [propertyPickerValue, setPropertyPickerValue] = useState('')

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
    setPropertyPickerValue('')
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
    <div className="space-y-6">
      {/* Existing Branches */}
      <section>
        <h3 className="font-semibold text-gray-900 mb-2">Existing Branches</h3>
        <p className="text-xs text-gray-500 mb-3">
          Branches that are already operational. They get locked as cluster centroids
          in Branch Optimization — k-means picks <em>additional</em> branches around
          them but never moves them.
        </p>

        {draft.existing_branches.length > 0 && (
          <div className="border rounded-lg overflow-hidden mb-3">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="text-left px-3 py-2">Name</th>
                  <th className="text-left px-3 py-2">Address</th>
                  <th className="text-left px-3 py-2">Lat / Lng</th>
                  <th className="text-center px-3 py-2">Locked</th>
                  <th className="text-right px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {draft.existing_branches.map((b, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-2 font-medium text-gray-900">{b.name}</td>
                    <td className="px-3 py-2 text-gray-600">{b.address ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500">
                      {b.lat && b.lng ? `${b.lat.toFixed(4)}, ${b.lng.toFixed(4)}` : 'pending geocode'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={b.locked !== false}
                        onChange={() => toggleLocked(i)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeBranch(i)}
                        className="text-red-600 hover:underline text-xs"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr_auto] gap-2">
          <input
            type="text"
            placeholder="Branch name (e.g. Frisco TX)"
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="text"
            placeholder="Address (e.g. 123 Main St, Frisco, TX 75034)"
            value={newBranchAddress}
            onChange={(e) => setNewBranchAddress(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <Button size="sm" onClick={addBranch} disabled={!newBranchName.trim() || !newBranchAddress.trim()}>
            + Add Branch
          </Button>
        </div>
        <p className="text-xs text-gray-400 mt-1">
          Coordinates are looked up via Google Geocoding when you save.
        </p>
      </section>

      {/* Excluded Properties */}
      <section className="border-t pt-5">
        <h3 className="font-semibold text-gray-900 mb-2">Excluded Properties</h3>
        <p className="text-xs text-gray-500 mb-3">
          Properties that are already covered by other crews and should be filtered out
          of every analysis. They still exist in the portfolio but won't appear in branch
          optimization, crew strategy, drive time, etc.
        </p>

        {draft.excluded_property_ids.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {draft.excluded_property_ids.map((id) => {
              const p = propertyById.get(id)
              return (
                <div
                  key={id}
                  className="flex items-center justify-between border rounded-lg px-3 py-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    {p ? (
                      <>
                        <div className="font-medium text-gray-900 truncate">{p.address_line1}</div>
                        <div className="text-xs text-gray-500">
                          {p.city}, {p.state} · <span className="font-mono">{id.slice(0, 8)}</span>
                        </div>
                      </>
                    ) : (
                      <div className="font-mono text-xs text-gray-500">{id}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeExclusion(id)}
                    className="text-red-600 hover:underline text-xs ml-3"
                  >
                    Remove
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <div className="space-y-2">
          <select
            value={propertyPickerValue}
            onChange={(e) => {
              setPropertyPickerValue(e.target.value)
              if (e.target.value) addExclusion(e.target.value)
            }}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">+ Add property to exclude…</option>
            {availableForExclusion.map((p) => (
              <option key={p.id} value={p.id}>
                {p.address_line1}, {p.city}, {p.state}
              </option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Reason for exclusion (e.g. Already served by UT/AZ/NV crews)"
            value={draft.excluded_property_reason ?? ''}
            onChange={(e) =>
              setDraft((d) => ({ ...d, excluded_property_reason: e.target.value }))
            }
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
    setDraft((d) => ({ ...d, population_constraint: { ...d.population_constraint, ...patch } }))

  return (
    <section className="border-t pt-5">
      <h3 className="font-semibold text-gray-900 mb-2">Population Constraint for Branch Siting</h3>
      <label className="flex items-center gap-2 cursor-pointer mb-2">
        <input
          type="checkbox"
          checked={pc.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <span className="text-sm font-medium text-gray-800">
          Restrict branch suggestions to cities above population threshold
        </span>
      </label>
      <p className="text-xs text-gray-500 mb-3">
        Branch optimization will only suggest locations in cities meeting these criteria.
        This ensures you can recruit the labor force needed to staff the branch. Smaller
        cities may produce lower drive cost but make hiring difficult.
      </p>

      {pc.enabled && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Minimum population
            </label>
            <input
              type="number"
              min={1000}
              max={5_000_000}
              step={5000}
              value={pc.min_population}
              onChange={(e) => update({ min_population: Number(e.target.value) || 50000 })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <p className="text-xs text-gray-400 mt-0.5">Default 50,000.</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Maximum population (optional)
            </label>
            <input
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
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Restrict to states (optional, 2-letter codes)
            </label>
            <input
              type="text"
              placeholder="e.g. TX,NM,OK,AZ"
              value={(pc.state_filter ?? []).join(',')}
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
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
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
    <section className="border-t pt-5">
      <h3 className="font-semibold text-gray-900 mb-2">Utilization Band</h3>
      <label className="flex items-center gap-2 cursor-pointer mb-2">
        <input
          type="checkbox"
          checked={u.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <span className="text-sm font-medium text-gray-800">
          Enforce utilization band on crew sizing
        </span>
      </label>

      {u.enabled && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-3">
            <NumberField
              label="Hard floor"
              value={u.hard_floor_pct}
              onChange={(v) => update({ hard_floor_pct: v })}
              suffix="%"
            />
            <NumberField
              label="Ideal min"
              value={u.ideal_min_pct}
              onChange={(v) => update({ ideal_min_pct: v })}
              suffix="%"
            />
            <NumberField
              label="Ideal max"
              value={u.ideal_max_pct}
              onChange={(v) => update({ ideal_max_pct: v })}
              suffix="%"
            />
            <NumberField
              label="Soft ceiling"
              value={u.soft_ceiling_pct}
              onChange={(v) => update({ soft_ceiling_pct: v })}
              suffix="%"
            />
          </div>

          {/* Color-coded band visualization 0..130% */}
          <UtilizationBandViz band={u} />
          {!valid && (
            <p className="text-xs text-red-600 mt-2">
              Invalid band: must be hard_floor &lt; ideal_min &lt; ideal_max &lt; soft_ceiling.
            </p>
          )}

          <div className="mt-4">
            <div className="text-xs font-semibold text-gray-700 mb-1">Constraint scope</div>
            <div className="flex flex-wrap gap-3 text-sm">
              {(['per_branch', 'per_region', 'portfolio'] as const).map((s) => (
                <label key={s} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    checked={u.scope === s}
                    onChange={() => update({ scope: s })}
                  />
                  <span className="capitalize">{s.replace('_', '-')}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Per-branch is most conservative — surfaces if any individual branch is over- or under-utilized.
              Portfolio is most permissive — only flags if the whole portfolio is unbalanced. Per-region is in
              between. Solutions outside the band are still shown but flagged.
            </p>
          </div>
        </>
      )}
    </section>
  )
}

function NumberField({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  suffix?: string
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-1">{label}</label>
      <div className="relative">
        <input
          type="number"
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n)) onChange(n)
          }}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm pr-7"
        />
        {suffix && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
            {suffix}
          </span>
        )}
      </div>
    </div>
  )
}

function UtilizationBandViz({
  band,
}: {
  band: { hard_floor_pct: number; soft_ceiling_pct: number; ideal_min_pct: number; ideal_max_pct: number }
}) {
  const max = 130
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
    <div className="mt-2">
      <div className="relative h-4 rounded bg-gray-100 overflow-hidden">
        {seg(0, band.hard_floor_pct, '#fecaca', 'low')}
        {seg(band.hard_floor_pct, band.ideal_min_pct, '#fde68a', 'lowmid')}
        {seg(band.ideal_min_pct, band.ideal_max_pct, '#bbf7d0', 'ideal')}
        {seg(band.ideal_max_pct, band.soft_ceiling_pct, '#fde68a', 'highmid')}
        {seg(band.soft_ceiling_pct, max, '#fecaca', 'high')}
      </div>
      <div className="flex justify-between text-[10px] font-mono text-gray-500 mt-0.5">
        <span>0%</span>
        <span>{band.hard_floor_pct}%</span>
        <span>{band.ideal_min_pct}%</span>
        <span>{band.ideal_max_pct}%</span>
        <span>{band.soft_ceiling_pct}%</span>
        <span>{max}%</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: numeric field grid (used for both Crew Economics + Cost & Margin)
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
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {fields.map((k) => {
        const cur = (draft as any)[k] as number
        const def = defaults?.[k]
        const isOverridden = def != null && cur != null && Math.abs(def - cur) > 1e-9
        return (
          <div key={k}>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              {FIELD_LABELS[k] ?? k}
              {isOverridden && (
                <span className="ml-1.5 text-blue-600 font-normal">(overridden)</span>
              )}
            </label>
            <input
              type="number"
              step="any"
              value={cur ?? ''}
              placeholder={def?.toString() ?? ''}
              onChange={(e) => onChange(k, e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {def != null && (
              <p className="text-xs text-gray-400 mt-0.5">System default: {def}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
