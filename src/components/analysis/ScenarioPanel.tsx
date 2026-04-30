import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import Button from '../ui/Button'
import Modal from '../ui/Modal'

interface BaselineSummary {
  bid_total: number | null
  bid_per_property: number | null
  monthly_invoice_estimate: number | null
  margin_pct: number | null
  crew_recommended_option: string | null
  crew_total_annual_cost: number | null
  branch_count_recommended: number | null
}

interface SelectedBranch {
  name: string
  city_state: string
  lat: number
  lng: number
  source?: string
}

interface SavedScenario {
  id: string
  name: string
  description: string | null
  overrides: Record<string, any>
  synthesis_summary: string | null
  created_at: string
}

interface Props {
  accountId: string
  clientId: string
  hasSelection: boolean
  // Baseline values pulled from current operational_constraints + bid_pricing run
  baselineLaborCost: number
  baselineFuelCost: number
  baselineMargin: number
  baselineSurgePremium: number
  selectedBranches: SelectedBranch[] | null
  selectedK: number | null
}

export default function ScenarioPanel({
  accountId,
  clientId,
  hasSelection,
  baselineLaborCost,
  baselineFuelCost,
  baselineMargin,
  baselineSurgePremium,
  selectedBranches,
  selectedK,
}: Props) {
  const { getToken } = useAuth()

  // Slider state — multipliers to make the UI clearer
  const [laborPct, setLaborPct] = useState(100)
  const [fuelPct, setFuelPct] = useState(100)
  const [marginPct, setMarginPct] = useState(Math.round(baselineMargin * 100))
  const [surgeMultiplier, setSurgeMultiplier] = useState(baselineSurgePremium)
  const [kOverride, setKOverride] = useState<number | ''>('')
  const [droppedBranchIdxs, setDroppedBranchIdxs] = useState<number[]>([])

  const [computing, setComputing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<any>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [savedScenarios, setSavedScenarios] = useState<SavedScenario[]>([])
  const [confirmApplyId, setConfirmApplyId] = useState<string | null>(null)
  const [confirmApplyDiff, setConfirmApplyDiff] = useState<any>(null)

  // Reset slider start positions when baselines change (e.g. after constraints update)
  useEffect(() => {
    setLaborPct(100)
    setFuelPct(100)
    setMarginPct(Math.round(baselineMargin * 100))
    setSurgeMultiplier(baselineSurgePremium)
  }, [baselineLaborCost, baselineFuelCost, baselineMargin, baselineSurgePremium])

  // Fetch saved scenarios on mount
  const refreshScenarios = async () => {
    try {
      const token = await getToken()
      const res = await fetch(`/api/accounts/${accountId}/clients/${clientId}/scenarios`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) setSavedScenarios((await res.json()) ?? [])
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    refreshScenarios()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, clientId])

  const overrides = useMemo(() => {
    const o: Record<string, any> = {}
    if (laborPct !== 100) {
      o.hourly_loaded_labor_cost = +(baselineLaborCost * (laborPct / 100)).toFixed(2)
    }
    if (fuelPct !== 100) {
      o.fuel_cost_per_mile = +(baselineFuelCost * (fuelPct / 100)).toFixed(3)
    }
    const targetMarginDecimal = marginPct / 100
    if (Math.abs(targetMarginDecimal - baselineMargin) > 0.0001) {
      o.target_gross_margin_pct = targetMarginDecimal
    }
    if (Math.abs(surgeMultiplier - baselineSurgePremium) > 0.0001) {
      o.surge_premium_multiplier = surgeMultiplier
    }
    if (kOverride !== '' && typeof kOverride === 'number') {
      o.k_override = kOverride
    }
    if (droppedBranchIdxs.length) {
      o.drop_branch_indices = [...droppedBranchIdxs].sort((a, b) => a - b)
    }
    return o
  }, [
    laborPct,
    fuelPct,
    marginPct,
    surgeMultiplier,
    kOverride,
    droppedBranchIdxs,
    baselineLaborCost,
    baselineFuelCost,
    baselineMargin,
    baselineSurgePremium,
  ])

  const changeCount = Object.keys(overrides).length

  const compute = async () => {
    setComputing(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(
        `/api/analyses/account/${accountId}/clients/${clientId}/scenario-compute`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ overrides }),
        }
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? `HTTP ${res.status}`)
        return
      }
      setResult(json)
    } catch (err: any) {
      setError(err?.message ?? String(err))
    } finally {
      setComputing(false)
    }
  }

  const saveScenario = async (name: string, description: string) => {
    const token = await getToken()
    const res = await fetch(`/api/accounts/${accountId}/clients/${clientId}/scenarios`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name,
        description,
        overrides,
        module_results: result?.scenario?.module_results ?? {},
      }),
    })
    if (res.ok) {
      setSaveOpen(false)
      await refreshScenarios()
    } else {
      const json = await res.json().catch(() => ({}))
      setError(`Save failed: ${json.error ?? res.statusText}`)
    }
  }

  const loadScenarioIntoSliders = (s: SavedScenario) => {
    const o = s.overrides ?? {}
    if (typeof o.hourly_loaded_labor_cost === 'number' && baselineLaborCost > 0) {
      setLaborPct(Math.round((o.hourly_loaded_labor_cost / baselineLaborCost) * 100))
    } else {
      setLaborPct(100)
    }
    if (typeof o.fuel_cost_per_mile === 'number' && baselineFuelCost > 0) {
      setFuelPct(Math.round((o.fuel_cost_per_mile / baselineFuelCost) * 100))
    } else {
      setFuelPct(100)
    }
    if (typeof o.target_gross_margin_pct === 'number') {
      setMarginPct(Math.round(o.target_gross_margin_pct * 100))
    } else {
      setMarginPct(Math.round(baselineMargin * 100))
    }
    if (typeof o.surge_premium_multiplier === 'number') {
      setSurgeMultiplier(o.surge_premium_multiplier)
    } else {
      setSurgeMultiplier(baselineSurgePremium)
    }
    setKOverride(typeof o.k_override === 'number' ? o.k_override : '')
    setDroppedBranchIdxs(Array.isArray(o.drop_branch_indices) ? o.drop_branch_indices : [])
  }

  const requestApply = async (scenarioId: string) => {
    const token = await getToken()
    const res = await fetch(
      `/api/accounts/${accountId}/clients/${clientId}/scenarios/${scenarioId}/apply`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ confirm: false }),
      }
    )
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(`Apply failed: ${json.error ?? res.statusText}`)
      return
    }
    setConfirmApplyId(scenarioId)
    setConfirmApplyDiff(json)
  }

  const confirmApply = async () => {
    if (!confirmApplyId) return
    const token = await getToken()
    const res = await fetch(
      `/api/accounts/${accountId}/clients/${clientId}/scenarios/${confirmApplyId}/apply?confirm=true`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ confirm: true }),
      }
    )
    if (res.ok) {
      setConfirmApplyId(null)
      setConfirmApplyDiff(null)
      // Reload page so constraints + module staleness pick up
      window.location.reload()
    } else {
      const json = await res.json().catch(() => ({}))
      setError(`Apply failed: ${json.error ?? res.statusText}`)
    }
  }

  const deleteScenario = async (id: string) => {
    const token = await getToken()
    const res = await fetch(`/api/accounts/${accountId}/clients/${clientId}/scenarios/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) await refreshScenarios()
  }

  if (!hasSelection) {
    return (
      <div className="bg-white rounded-xl border shadow-sm px-5 py-4 opacity-60">
        <h3 className="font-semibold text-gray-900">Scenarios — What-If Analysis</h3>
        <p className="text-sm text-gray-500 mt-1">
          Confirm a branch selection and run all modules first to enable scenarios.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm">
      <div className="px-5 py-4 border-b">
        <h3 className="font-semibold text-gray-900">Scenarios — What-If Analysis</h3>
        <p className="text-sm text-gray-500 mt-1">
          Move sliders to draft a scenario. Click Compute to run; the results show
          alongside your baseline.
        </p>
      </div>

      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-5">
        <SliderRow
          label="Labor cost"
          subtitle={`Hourly loaded labor: $${baselineLaborCost.toFixed(2)} → $${(baselineLaborCost * (laborPct / 100)).toFixed(2)}`}
          value={laborPct}
          min={80}
          max={125}
          step={5}
          unit="%"
          onChange={setLaborPct}
        />
        <SliderRow
          label="Fuel cost"
          subtitle={`Fuel per mile: $${baselineFuelCost.toFixed(3)} → $${(baselineFuelCost * (fuelPct / 100)).toFixed(3)}`}
          value={fuelPct}
          min={70}
          max={150}
          step={10}
          unit="%"
          onChange={setFuelPct}
        />
        <SliderRow
          label="Target gross margin"
          subtitle={`Margin: ${(baselineMargin * 100).toFixed(0)}% → ${marginPct}%`}
          value={marginPct}
          min={15}
          max={35}
          step={1}
          unit="%"
          onChange={setMarginPct}
        />
        <SliderRow
          label="Surge crew premium"
          subtitle={`Surge multiplier: ${baselineSurgePremium.toFixed(1)}x → ${surgeMultiplier.toFixed(1)}x`}
          value={Math.round(surgeMultiplier * 100)}
          min={100}
          max={200}
          step={10}
          unit="%"
          onChange={(v) => setSurgeMultiplier(v / 100)}
        />

        {/* K override */}
        <div className="sm:col-span-2 border-t pt-4">
          <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
            Branch count override
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-gray-600">
              Selected K = <span className="font-semibold">{selectedK ?? '?'}</span>. Try:
            </span>
            {[1, 2, 3, 4, 5, 6, 7].map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKOverride(kOverride === k ? '' : k)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium border ${
                  kOverride === k
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                K={k}
              </button>
            ))}
            {kOverride !== '' && (
              <button
                type="button"
                onClick={() => setKOverride('')}
                className="text-xs text-gray-500 hover:underline"
              >
                Clear
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Re-runs Branch Optimization at the new K and uses its computed centroids
            for this scenario.
          </p>
        </div>

        {/* Drop branches */}
        {selectedBranches && selectedBranches.length > 0 && (
          <div className="sm:col-span-2 border-t pt-4">
            <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
              Drop branches (toggle to remove from scenario)
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedBranches.map((b, i) => {
                const dropped = droppedBranchIdxs.includes(i)
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() =>
                      setDroppedBranchIdxs((cur) =>
                        cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]
                      )
                    }
                    className={`px-2.5 py-1 rounded-md text-xs font-medium border ${
                      dropped
                        ? 'bg-red-50 text-red-700 border-red-200 line-through'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {b.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Compute / Save bar */}
      <div className="px-5 py-3 border-t bg-gray-50 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-gray-600">
          {changeCount === 0 ? (
            <span>No changes from baseline.</span>
          ) : (
            <span>
              <strong>Draft scenario:</strong> {changeCount} change{changeCount === 1 ? '' : 's'}{' '}
              from baseline
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {result && (
            <Button variant="secondary" size="sm" onClick={() => setSaveOpen(true)}>
              Save scenario
            </Button>
          )}
          <Button
            size="sm"
            onClick={compute}
            loading={computing}
            disabled={changeCount === 0 || computing}
          >
            Compute Scenario
          </Button>
        </div>
      </div>

      {error && (
        <div className="px-5 py-3 border-t bg-red-50 text-sm text-red-700">{error}</div>
      )}

      {/* Side-by-side compare */}
      {result && <ScenarioCompare result={result} />}

      {/* Saved scenarios */}
      {savedScenarios.length > 0 && (
        <div className="px-5 py-4 border-t">
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Saved scenarios</h4>
          <div className="space-y-2">
            {savedScenarios.map((s) => (
              <div key={s.id} className="border rounded-lg px-3 py-2 flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-gray-900">{s.name}</div>
                  {s.description && (
                    <div className="text-xs text-gray-500">{s.description}</div>
                  )}
                  <div className="text-xs text-gray-400 mt-0.5">
                    {Object.keys(s.overrides ?? {}).length} change{Object.keys(s.overrides ?? {}).length === 1 ? '' : 's'} ·
                    saved {new Date(s.created_at).toLocaleString()}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => loadScenarioIntoSliders(s)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Load
                  </button>
                  <button
                    type="button"
                    onClick={() => requestApply(s.id)}
                    className="text-xs text-emerald-700 hover:underline"
                  >
                    Apply to constraints
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteScenario(s.id)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Save modal */}
      {saveOpen && (
        <SaveScenarioModal
          open={saveOpen}
          onClose={() => setSaveOpen(false)}
          onSave={saveScenario}
        />
      )}

      {/* Apply confirmation modal */}
      {confirmApplyId && confirmApplyDiff && (
        <Modal open onClose={() => setConfirmApplyId(null)} title="Apply scenario to constraints" size="md">
          <p className="text-sm text-gray-700 mb-3">{confirmApplyDiff.message}</p>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="text-left px-3 py-2">Field</th>
                  <th className="text-right px-3 py-2">From</th>
                  <th className="text-right px-3 py-2">To</th>
                </tr>
              </thead>
              <tbody>
                {(confirmApplyDiff.diff ?? []).map((d: any) => (
                  <tr key={d.key} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs text-gray-700">{d.key}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatValue(d.from)}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{formatValue(d.to)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" size="sm" onClick={() => setConfirmApplyId(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={confirmApply}>
              Apply
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function SliderRow({
  label,
  subtitle,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string
  subtitle: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{label}</div>
          <div className="text-xs text-gray-500 mt-0.5">{subtitle}</div>
        </div>
        <div className="font-mono text-sm font-semibold text-gray-900">
          {value}
          {unit}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full mt-2"
      />
      <div className="flex justify-between text-[10px] font-mono text-gray-400 mt-0.5">
        <span>
          {min}
          {unit}
        </span>
        <span>
          {max}
          {unit}
        </span>
      </div>
    </div>
  )
}

function ScenarioCompare({ result }: { result: any }) {
  const b = result.baseline?.summary ?? {}
  const s = result.scenario?.summary ?? {}
  const deltas = result.deltas ?? {}
  const rows: Array<{ key: string; label: string; isCurrency: boolean }> = [
    { key: 'bid_total', label: 'Annual bid', isCurrency: true },
    { key: 'bid_per_property', label: 'Bid per property', isCurrency: true },
    { key: 'monthly_invoice_estimate', label: 'Monthly invoice', isCurrency: true },
    { key: 'crew_total_annual_cost', label: 'Crew strategy total', isCurrency: true },
  ]
  return (
    <div className="px-5 py-4 border-t bg-blue-50/30">
      <h4 className="text-sm font-semibold text-gray-700 mb-2">Scenario vs baseline</h4>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-gray-500">
            <th className="text-left py-2"></th>
            <th className="text-right py-2 pr-4">Baseline</th>
            <th className="text-right py-2 pr-4">Scenario</th>
            <th className="text-right py-2">Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const delta = deltas[r.key]
            const pct = delta?.pct
            const colorClass =
              pct == null ? 'text-gray-500' : pct > 0 ? 'text-red-600' : pct < 0 ? 'text-green-600' : 'text-gray-500'
            return (
              <tr key={r.key} className="border-t">
                <td className="py-2 font-medium text-gray-700">{r.label}</td>
                <td className="text-right font-mono py-2 pr-4">{formatNumber((b as any)[r.key], r.isCurrency)}</td>
                <td className="text-right font-mono py-2 pr-4 font-semibold">
                  {formatNumber((s as any)[r.key], r.isCurrency)}
                </td>
                <td className={`text-right font-mono py-2 ${colorClass}`}>
                  {pct == null ? '—' : `${pct > 0 ? '+' : ''}${pct}%`}
                </td>
              </tr>
            )
          })}
          <tr className="border-t">
            <td className="py-2 font-medium text-gray-700">Recommended K</td>
            <td className="text-right font-mono py-2 pr-4">{b.branch_count_recommended ?? '—'}</td>
            <td className="text-right font-mono py-2 pr-4 font-semibold">{s.branch_count_recommended ?? '—'}</td>
            <td className="text-right font-mono py-2 text-gray-400">—</td>
          </tr>
          <tr className="border-t">
            <td className="py-2 font-medium text-gray-700">Recommended crew option</td>
            <td className="text-right font-mono py-2 pr-4">{b.crew_recommended_option ?? '—'}</td>
            <td className="text-right font-mono py-2 pr-4 font-semibold">{s.crew_recommended_option ?? '—'}</td>
            <td className="text-right font-mono py-2 text-gray-400">—</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function SaveScenarioModal({
  open,
  onClose,
  onSave,
}: {
  open: boolean
  onClose: () => void
  onSave: (name: string, description: string) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  return (
    <Modal open={open} onClose={onClose} title="Save scenario" size="md">
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Higher labor scenario"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">Description (optional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => name.trim() && onSave(name.trim(), description.trim())} disabled={!name.trim()}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function formatValue(v: any): string {
  if (typeof v !== 'number') return String(v)
  if (Math.abs(v) >= 1000) return v.toLocaleString()
  if (Math.abs(v) < 1) return v.toFixed(3)
  return v.toString()
}

function formatNumber(v: any, isCurrency: boolean): string {
  if (typeof v !== 'number') return '—'
  if (isCurrency) {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
    if (v >= 1_000) return `$${Math.round(v).toLocaleString()}`
    return `$${v.toFixed(2)}`
  }
  return v.toLocaleString()
}
