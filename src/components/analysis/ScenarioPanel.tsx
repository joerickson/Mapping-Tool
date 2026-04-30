import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import Button from '../ui/Button'
import { Badge } from '../ui/Badge'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog'
import { FormField, Input, Textarea } from '../ui/Input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/Table'
import { cn } from '../../lib/cn'

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

  const refreshScenarios = async () => {
    try {
      const token = await getToken()
      const res = await fetch(
        `/api/accounts/${accountId}/clients/${clientId}/scenarios`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
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
    const res = await fetch(
      `/api/accounts/${accountId}/clients/${clientId}/scenarios`,
      {
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
      }
    )
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
    const res = await fetch(
      `/api/accounts/${accountId}/clients/${clientId}/scenarios/${id}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
    )
    if (res.ok) await refreshScenarios()
  }

  if (!hasSelection) {
    return (
      <div className="rounded-lg border border-border bg-surface px-6 py-5 opacity-60">
        <h3 className="text-base font-semibold tracking-tight text-fg">
          Scenarios — what-if analysis
        </h3>
        <p className="mt-1 text-sm text-fg-muted">
          Confirm a branch selection and run all modules first to enable scenarios.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <div className="border-b border-border px-6 py-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-semibold tracking-tight text-fg">
            Scenarios — what-if analysis
          </h3>
          <p className="mt-1 text-sm text-fg-muted">
            Move sliders to draft a scenario. Click Compute to run; the results
            show alongside your baseline.
          </p>
        </div>
        {changeCount > 0 ? (
          <Badge variant="accent">
            Draft: <span className="font-tabular">{changeCount}</span>{' '}
            {changeCount === 1 ? 'change' : 'changes'}
          </Badge>
        ) : (
          <Badge>Baseline</Badge>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 p-6 sm:grid-cols-2">
        <SliderRow
          label="Labor cost"
          subtitle={`Hourly loaded: $${baselineLaborCost.toFixed(2)} → $${(baselineLaborCost * (laborPct / 100)).toFixed(2)}`}
          value={laborPct}
          min={80}
          max={125}
          step={5}
          unit="%"
          onChange={setLaborPct}
        />
        <SliderRow
          label="Fuel cost"
          subtitle={`Per mile: $${baselineFuelCost.toFixed(3)} → $${(baselineFuelCost * (fuelPct / 100)).toFixed(3)}`}
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
          subtitle={`Multiplier: ${baselineSurgePremium.toFixed(1)}x → ${surgeMultiplier.toFixed(1)}x`}
          value={Math.round(surgeMultiplier * 100)}
          min={100}
          max={200}
          step={10}
          unit="%"
          onChange={(v) => setSurgeMultiplier(v / 100)}
        />

        {/* K override */}
        <div className="border-t border-border pt-4 sm:col-span-2">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
            Branch count override
          </p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-fg-muted">
              Selected K ={' '}
              <span className="font-semibold text-fg font-tabular">
                {selectedK ?? '?'}
              </span>
              . Try:
            </span>
            {[1, 2, 3, 4, 5, 6, 7].map((k) => (
              <KChip
                key={k}
                k={k}
                active={kOverride === k}
                onToggle={() => setKOverride(kOverride === k ? '' : k)}
              />
            ))}
            {kOverride !== '' && (
              <button
                type="button"
                onClick={() => setKOverride('')}
                className="text-xs text-fg-muted hover:text-fg hover:underline"
              >
                Clear
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-fg-subtle">
            Re-runs Branch Optimization at the new K and uses its computed
            centroids for this scenario.
          </p>
        </div>

        {/* Drop branches */}
        {selectedBranches && selectedBranches.length > 0 && (
          <div className="border-t border-border pt-4 sm:col-span-2">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              Drop branches (toggle to remove from scenario)
            </p>
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
                    className={cn(
                      'inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      dropped
                        ? 'border-danger/40 bg-danger-subtle text-danger line-through'
                        : 'border-border bg-surface text-fg hover:bg-surface-muted hover:border-border-strong'
                    )}
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
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-subtle px-6 py-3">
        <p className="text-sm text-fg-muted">
          {changeCount === 0 ? (
            'No changes from baseline.'
          ) : (
            <>
              <span className="font-semibold text-fg">Draft scenario:</span>{' '}
              <span className="font-tabular">{changeCount}</span> change
              {changeCount === 1 ? '' : 's'} from baseline
            </>
          )}
        </p>
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
            Compute scenario
          </Button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="border-t border-danger/20 bg-danger-subtle px-6 py-3 text-sm text-danger"
        >
          {error}
        </div>
      )}

      {/* Side-by-side compare */}
      {result && <ScenarioCompare result={result} />}

      {/* Saved scenarios */}
      {savedScenarios.length > 0 && (
        <div className="space-y-2 border-t border-border px-6 py-5">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
            Saved scenarios
          </h4>
          <ul className="space-y-2">
            {savedScenarios.map((s) => {
              const overrideCount = Object.keys(s.overrides ?? {}).length
              return (
                <li
                  key={s.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-sm font-medium text-fg">{s.name}</p>
                    {s.description && (
                      <p className="text-xs text-fg-muted">{s.description}</p>
                    )}
                    <p className="text-xs text-fg-subtle">
                      <span className="font-tabular">{overrideCount}</span>{' '}
                      {overrideCount === 1 ? 'change' : 'changes'} · saved{' '}
                      <span className="font-tabular">
                        {new Date(s.created_at).toLocaleString()}
                      </span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => loadScenarioIntoSliders(s)}
                      className="text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
                    >
                      Load
                    </button>
                    <button
                      type="button"
                      onClick={() => requestApply(s.id)}
                      className="text-success hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
                    >
                      Apply to constraints
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteScenario(s.id)}
                      className="text-danger hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Save dialog */}
      <SaveScenarioDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        onSave={saveScenario}
      />

      {/* Apply confirmation dialog */}
      <Dialog
        open={!!confirmApplyId && !!confirmApplyDiff}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmApplyId(null)
            setConfirmApplyDiff(null)
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Apply scenario to constraints</DialogTitle>
            {confirmApplyDiff?.message && (
              <DialogDescription>{confirmApplyDiff.message}</DialogDescription>
            )}
          </DialogHeader>
          <div className="rounded-md border border-border bg-surface overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead className="text-right">From</TableHead>
                  <TableHead className="text-right">To</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(confirmApplyDiff?.diff ?? []).map((d: any) => (
                  <TableRow key={d.key}>
                    <TableCell className="font-mono text-xs text-fg">{d.key}</TableCell>
                    <TableCell numeric className="text-fg-muted">
                      {formatValue(d.from)}
                    </TableCell>
                    <TableCell numeric className="font-semibold text-fg">
                      {formatValue(d.to)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button size="sm" onClick={confirmApply}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function KChip({
  k,
  active,
  onToggle,
}: {
  k: number
  active: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'inline-flex h-7 items-center rounded-md border px-2.5 font-mono text-xs font-medium tabular-nums transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        active
          ? 'border-accent bg-accent text-accent-fg'
          : 'border-border bg-surface text-fg hover:bg-surface-muted hover:border-border-strong'
      )}
    >
      K={k}
    </button>
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
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
            {label}
          </p>
          <p className="mt-0.5 text-xs text-fg-muted">{subtitle}</p>
        </div>
        <p className="font-mono text-sm font-semibold tabular-nums text-fg">
          {value}
          {unit}
        </p>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-accent"
      />
      <div className="mt-0.5 flex justify-between font-mono text-[10px] text-fg-subtle">
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
    <div className="space-y-2 border-t border-border bg-accent-subtle/30 px-6 py-5">
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
        Scenario vs baseline
      </h4>
      <div className="rounded-md border border-border bg-surface overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead />
              <TableHead className="text-right">Baseline</TableHead>
              <TableHead className="text-right">Scenario</TableHead>
              <TableHead className="text-right">Δ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const delta = deltas[r.key]
              const pct = delta?.pct
              return (
                <TableRow key={r.key}>
                  <TableCell className="font-medium text-fg">{r.label}</TableCell>
                  <TableCell numeric className="text-fg-muted">
                    {formatNumber((b as any)[r.key], r.isCurrency)}
                  </TableCell>
                  <TableCell numeric className="font-semibold text-fg">
                    {formatNumber((s as any)[r.key], r.isCurrency)}
                  </TableCell>
                  <TableCell
                    numeric
                    className={cn(
                      pct == null
                        ? 'text-fg-subtle'
                        : pct > 0
                          ? 'text-danger'
                          : pct < 0
                            ? 'text-success'
                            : 'text-fg-subtle'
                    )}
                  >
                    {pct == null ? '—' : `${pct > 0 ? '+' : ''}${pct}%`}
                  </TableCell>
                </TableRow>
              )
            })}
            <TableRow>
              <TableCell className="font-medium text-fg">Recommended K</TableCell>
              <TableCell numeric className="text-fg-muted">
                {b.branch_count_recommended ?? '—'}
              </TableCell>
              <TableCell numeric className="font-semibold text-fg">
                {s.branch_count_recommended ?? '—'}
              </TableCell>
              <TableCell numeric className="text-fg-subtle">—</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-fg">
                Recommended crew option
              </TableCell>
              <TableCell numeric className="text-fg-muted">
                {b.crew_recommended_option ?? '—'}
              </TableCell>
              <TableCell numeric className="font-semibold text-fg">
                {s.crew_recommended_option ?? '—'}
              </TableCell>
              <TableCell numeric className="text-fg-subtle">—</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function SaveScenarioDialog({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (name: string, description: string) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Save scenario</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <FormField label="Name" htmlFor="save-scenario-name">
            <Input
              id="save-scenario-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Higher labor scenario"
              autoFocus
            />
          </FormField>
          <FormField label="Description" htmlFor="save-scenario-desc" helper="Optional">
            <Textarea
              id="save-scenario-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </FormField>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <Button
            size="sm"
            onClick={() => name.trim() && onSave(name.trim(), description.trim())}
            disabled={!name.trim()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
