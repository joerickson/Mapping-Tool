// Phase 4 — service line pricing config editor on the Cost Assumptions
// panel. Lists each (account, client, offering) row with its rate,
// billable %, and target margin override; click a row to edit.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Pencil } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import Button from '../ui/Button'
import { Badge } from '../ui/Badge'
import { Input, FormField, Textarea } from '../ui/Input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/Select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/Table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog'

type PricingModel = 'per_visit_blended_sqft' | 'per_sqft_monthly'

interface PricingConfig {
  id: string | null
  service_offering_id: string
  pricing_model: PricingModel
  rate_per_sqft_per_visit: number | null
  rate_per_sqft_per_month: number | null
  billable_sqft_pct: number
  billable_sqft_pct_notes?: string | null
  target_gross_margin_pct_override: number | null
  service_offering: { id: string; name: string; offering_role?: string | null } | null
  // Phase 4 follow-up — endpoint returns every offering, including
  // those without a saved config. has_config = true when a row
  // exists in service_line_pricing_config, false for placeholder rows.
  has_config?: boolean
}

interface Props {
  clientId: string
  accountTargetMarginPct: number
  onSaved?: () => void
}

export default function ServiceLinePricingSection({
  clientId,
  accountTargetMarginPct,
  onSaved,
}: Props) {
  const { getToken } = useAuth()
  const [configs, setConfigs] = useState<PricingConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<PricingConfig | null>(null)

  const refresh = useCallback(async () => {
    if (!clientId) return
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/clients/${clientId}/service-line-pricing`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`Load failed: ${res.status}`)
      const j = await res.json()
      setConfigs((j.configs ?? []) as PricingConfig[])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [clientId, getToken])

  useEffect(() => {
    refresh()
  }, [refresh])

  const save = async (updated: PricingConfig) => {
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/clients/${clientId}/service-line-pricing`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          configs: [
            {
              service_offering_id: updated.service_offering_id,
              pricing_model: updated.pricing_model,
              rate_per_sqft_per_visit:
                updated.pricing_model === 'per_visit_blended_sqft'
                  ? updated.rate_per_sqft_per_visit
                  : null,
              rate_per_sqft_per_month:
                updated.pricing_model === 'per_sqft_monthly'
                  ? updated.rate_per_sqft_per_month
                  : null,
              billable_sqft_pct: updated.billable_sqft_pct,
              billable_sqft_pct_notes: updated.billable_sqft_pct_notes,
              target_gross_margin_pct_override:
                updated.target_gross_margin_pct_override,
            },
          ],
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as any).error ?? `Save failed: ${res.status}`)
      }
      setEditing(null)
      await refresh()
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const sorted = useMemo(
    () => [...configs].sort((a, b) =>
      (a.service_offering?.name ?? '').localeCompare(b.service_offering?.name ?? '')
    ),
    [configs]
  )

  if (loading) {
    return (
      <section className="mt-6">
        <p className="text-xs text-fg-muted flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading service line pricing…
        </p>
      </section>
    )
  }

  return (
    <section
      id="cost-group-service-line-pricing"
      className="space-y-3 mt-6 scroll-mt-16"
    >
      <header>
        <h3 className="text-sm font-semibold text-fg">Service line pricing</h3>
        <p className="text-xs text-fg-muted mt-0.5">
          Set per-line rates and billable-sqft percentages. Each line is
          priced separately and quoted with its own margin.
        </p>
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </header>

      {sorted.length === 0 ? (
        <p className="text-xs text-fg-muted italic">
          No service offerings exist for this client yet. Create offerings first
          and they'll show here for pricing.
        </p>
      ) : (
        <div className="rounded-md border border-border bg-surface overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service line</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Billable %</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((c) => {
                const isVisit = c.pricing_model === 'per_visit_blended_sqft'
                const rate = isVisit
                  ? c.rate_per_sqft_per_visit
                  : c.rate_per_sqft_per_month
                const marginText =
                  c.target_gross_margin_pct_override != null
                    ? `${c.target_gross_margin_pct_override}%`
                    : `${accountTargetMarginPct.toFixed(0)}% (default)`
                const hasConfig = c.has_config !== false && rate != null
                return (
                  <TableRow
                    key={c.service_offering_id}
                    className={!hasConfig ? 'bg-warning-subtle/30' : undefined}
                  >
                    <TableCell className="font-medium text-fg">
                      {c.service_offering?.name ?? '(unknown)'}
                      {!hasConfig && (
                        <span className="ml-2 text-[10px] text-warning font-medium">
                          unpriced
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {isVisit ? 'Per visit' : 'Per month'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-tabular text-xs">
                      {rate != null
                        ? `$${Number(rate).toFixed(2)}/sqft`
                        : <span className="text-warning">no rate</span>}
                    </TableCell>
                    <TableCell className="text-right font-tabular text-xs">
                      {Number(c.billable_sqft_pct).toFixed(0)}%
                    </TableCell>
                    <TableCell className="text-right font-tabular text-xs">
                      {marginText}
                    </TableCell>
                    <TableCell className="text-right">
                      <button
                        type="button"
                        onClick={() => setEditing(c)}
                        className={
                          hasConfig
                            ? 'text-fg-subtle hover:text-accent inline-flex items-center gap-1 text-xs'
                            : 'text-accent hover:underline inline-flex items-center gap-1 text-xs font-medium'
                        }
                      >
                        <Pencil className="h-3 w-3" />
                        {hasConfig ? 'Edit' : 'Set rate'}
                      </button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {editing && (
        <EditDialog
          config={editing}
          accountTargetMarginPct={accountTargetMarginPct}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </section>
  )
}

function EditDialog({
  config,
  accountTargetMarginPct,
  onClose,
  onSave,
}: {
  config: PricingConfig
  accountTargetMarginPct: number
  onClose: () => void
  onSave: (updated: PricingConfig) => void | Promise<void>
}) {
  const [model, setModel] = useState<PricingModel>(config.pricing_model)
  const [rateVisit, setRateVisit] = useState(
    config.rate_per_sqft_per_visit != null
      ? String(config.rate_per_sqft_per_visit)
      : ''
  )
  const [rateMonth, setRateMonth] = useState(
    config.rate_per_sqft_per_month != null
      ? String(config.rate_per_sqft_per_month)
      : ''
  )
  const [billable, setBillable] = useState(String(config.billable_sqft_pct))
  const [notes, setNotes] = useState(config.billable_sqft_pct_notes ?? '')
  const [marginOv, setMarginOv] = useState(
    config.target_gross_margin_pct_override != null
      ? String(config.target_gross_margin_pct_override)
      : ''
  )
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    await onSave({
      ...config,
      pricing_model: model,
      rate_per_sqft_per_visit:
        model === 'per_visit_blended_sqft' ? parseFloat(rateVisit) || 0 : null,
      rate_per_sqft_per_month:
        model === 'per_sqft_monthly' ? parseFloat(rateMonth) || 0 : null,
      billable_sqft_pct: Math.max(0, Math.min(100, parseFloat(billable) || 0)),
      billable_sqft_pct_notes: notes.trim() || null,
      target_gross_margin_pct_override:
        marginOv.trim() === '' ? null : parseFloat(marginOv),
    })
    setSaving(false)
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{config.service_offering?.name} — Pricing</DialogTitle>
          <DialogDescription>
            Per-line rate, billable sqft %, and optional margin override. Saving
            triggers Bid Pricing to recompute.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FormField label="Pricing model">
            <Select value={model} onValueChange={(v) => setModel(v as PricingModel)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="per_visit_blended_sqft">
                  Per visit (rate × billable sqft × visits/yr)
                </SelectItem>
                <SelectItem value="per_sqft_monthly">
                  Per sqft per month
                </SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          {model === 'per_visit_blended_sqft' ? (
            <FormField label="Rate per sqft per visit">
              <div className="flex items-center gap-2">
                <span className="text-fg-muted">$</span>
                <Input
                  type="number"
                  step="0.01"
                  value={rateVisit}
                  onChange={(e) => setRateVisit(e.target.value)}
                  className="max-w-[120px]"
                />
                <span className="text-fg-muted text-sm">/sqft/visit</span>
              </div>
            </FormField>
          ) : (
            <FormField label="Rate per sqft per month">
              <div className="flex items-center gap-2">
                <span className="text-fg-muted">$</span>
                <Input
                  type="number"
                  step="0.01"
                  value={rateMonth}
                  onChange={(e) => setRateMonth(e.target.value)}
                  className="max-w-[120px]"
                />
                <span className="text-fg-muted text-sm">/sqft/month</span>
              </div>
            </FormField>
          )}
          <FormField
            label="Billable sqft %"
            helper="Percentage of measured sqft that's billable per the contract (e.g., 92% if common areas excluded)."
          >
            <div className="flex items-center gap-2">
              <Input
                type="number"
                step="1"
                min="0"
                max="100"
                value={billable}
                onChange={(e) => setBillable(e.target.value)}
                className="max-w-[100px]"
              />
              <span>%</span>
            </div>
          </FormField>
          <FormField label="Notes (optional)">
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="JLL bills 92% — excludes common areas"
            />
          </FormField>
          <FormField
            label={`Target margin override (account default: ${accountTargetMarginPct.toFixed(0)}%)`}
            helper="Leave blank to inherit the account's target margin."
          >
            <div className="flex items-center gap-2">
              <Input
                type="number"
                step="0.5"
                min="0"
                max="100"
                value={marginOv}
                onChange={(e) => setMarginOv(e.target.value)}
                className="max-w-[100px]"
              />
              <span>%</span>
            </div>
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
