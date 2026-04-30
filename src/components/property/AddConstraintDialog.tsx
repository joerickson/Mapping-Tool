// Add Constraint dialog — service location → type → enforcement → config →
// optional notes → submit. Type picker is grouped (Schedule / Access /
// Operations) to make the type-set discoverable. Per-type config form swaps
// inline — no multi-step wizard since each type's config is small.
import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import Button from '../ui/Button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/Dialog'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
} from '../ui/Select'
import { Input, Textarea, FormField } from '../ui/Input'
import { cn } from '../../lib/cn'
import {
  CONSTRAINT_LABELS,
  CONSTRAINT_DESCRIPTIONS,
  CONSTRAINT_GROUPS,
  type ConstraintType,
} from './constraint-types'
import type { ServiceLocation } from '../../types'

interface Props {
  open: boolean
  onClose: () => void
  serviceLocations: ServiceLocation[]
  onCreated: () => void
}

export default function AddConstraintDialog({
  open,
  onClose,
  serviceLocations,
  onCreated,
}: Props) {
  const { getToken } = useAuth()

  const [serviceLocationId, setServiceLocationId] = useState<string>(
    serviceLocations[0]?.service_location_id ?? ''
  )
  const [type, setType] = useState<ConstraintType>('day_of_week')
  const [enforcement, setEnforcement] = useState<'hard' | 'soft'>('hard')
  const [config, setConfig] = useState<Record<string, unknown>>(() => defaultConfig('day_of_week'))
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset config when type changes
  function changeType(next: ConstraintType) {
    setType(next)
    setConfig(defaultConfig(next))
  }

  function reset() {
    setServiceLocationId(serviceLocations[0]?.service_location_id ?? '')
    setType('day_of_week')
    setEnforcement('hard')
    setConfig(defaultConfig('day_of_week'))
    setNotes('')
    setError(null)
  }

  async function handleSubmit() {
    if (!serviceLocationId) {
      setError('Pick a service location.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/service-locations/${serviceLocationId}/constraints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ constraint_type: type, enforcement, config, notes }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const detail = Array.isArray(body.details) ? ` — ${body.details.join('; ')}` : ''
        throw new Error(`${body.error ?? `Save failed (${res.status})`}${detail}`)
      }
      reset()
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset()
          onClose()
        }
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add service constraint</DialogTitle>
          <DialogDescription>
            Schedule, access, or operational rule for one service location.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {serviceLocations.length > 1 && (
            <FormField label="Service location" htmlFor="constraint-sl">
              <Select value={serviceLocationId} onValueChange={setServiceLocationId}>
                <SelectTrigger id="constraint-sl">
                  <SelectValue placeholder="Pick a service location" />
                </SelectTrigger>
                <SelectContent>
                  {serviceLocations.map((sl) => (
                    <SelectItem key={sl.service_location_id} value={sl.service_location_id}>
                      {sl.display_name ?? sl.service_location_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}

          <FormField label="Constraint type" htmlFor="constraint-type" helper={CONSTRAINT_DESCRIPTIONS[type]}>
            <Select value={type} onValueChange={(v) => changeType(v as ConstraintType)}>
              <SelectTrigger id="constraint-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONSTRAINT_GROUPS.map((g) => (
                  <SelectGroup key={g.label}>
                    <SelectLabel>{g.label}</SelectLabel>
                    {g.types.map((t) => (
                      <SelectItem key={t} value={t}>
                        {CONSTRAINT_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Enforcement">
            <div className="flex gap-2">
              {(['hard', 'soft'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setEnforcement(opt)}
                  className={cn(
                    'flex-1 rounded-md border px-3 py-2 text-sm transition-colors',
                    enforcement === opt
                      ? 'border-accent bg-accent/10 text-fg'
                      : 'border-border bg-surface text-fg-muted hover:text-fg'
                  )}
                >
                  <span className="font-medium capitalize">{opt}</span>
                  <span className="block text-[11px] text-fg-subtle mt-0.5">
                    {opt === 'hard' ? 'Must satisfy' : 'Preference'}
                  </span>
                </button>
              ))}
            </div>
          </FormField>

          <ConfigForm type={type} config={config} setConfig={setConfig} />

          <FormField label="Notes (optional)" htmlFor="constraint-notes">
            <Textarea
              id="constraint-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional context, exceptions, etc."
              rows={2}
            />
          </FormField>

          {error && <p className="text-xs text-danger">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} loading={submitting}>Save constraint</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function defaultConfig(type: ConstraintType): Record<string, unknown> {
  switch (type) {
    case 'day_of_week':
      return { allowed_days: [1, 2, 3, 4, 5] } // Mon–Fri
    case 'blackout_dates':
      return { dates: [] }
    case 'seasonal_window':
      return { start_month: 1, end_month: 12 }
    case 'time_window':
      return { earliest_start: '08:00', latest_end: '17:00' }
    case 'access_requirement':
      return { kind: 'badge' }
    case 'contact_requirement':
      return {}
  }
}

// Per-type config form. Edits flow through setConfig — never uses an
// internal form lib because (a) the shapes are tiny and (b) the API
// re-validates everything anyway.
function ConfigForm({
  type,
  config,
  setConfig,
}: {
  type: ConstraintType
  config: Record<string, unknown>
  setConfig: (c: Record<string, unknown>) => void
}) {
  if (type === 'day_of_week') return <DayOfWeekForm config={config} setConfig={setConfig} />
  if (type === 'blackout_dates') return <BlackoutDatesForm config={config} setConfig={setConfig} />
  if (type === 'seasonal_window') return <SeasonalWindowForm config={config} setConfig={setConfig} />
  if (type === 'time_window') return <TimeWindowForm config={config} setConfig={setConfig} />
  if (type === 'access_requirement') return <AccessRequirementForm config={config} setConfig={setConfig} />
  if (type === 'contact_requirement') return <ContactRequirementForm config={config} setConfig={setConfig} />
  return null
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function DayOfWeekForm({
  config,
  setConfig,
}: { config: Record<string, unknown>; setConfig: (c: Record<string, unknown>) => void }) {
  const days = new Set((config.allowed_days as number[] | undefined) ?? [])
  const toggle = (d: number) => {
    const next = new Set(days)
    if (next.has(d)) next.delete(d)
    else next.add(d)
    setConfig({ allowed_days: Array.from(next).sort((a, b) => a - b) })
  }
  return (
    <FormField label="Allowed days" helper="Tap to toggle. Service is allowed only on selected days.">
      <div className="flex gap-1">
        {DAY_LABELS.map((label, i) => {
          const on = days.has(i)
          return (
            <button
              key={i}
              type="button"
              onClick={() => toggle(i)}
              className={cn(
                'flex-1 rounded-md border px-2 py-2 text-xs font-medium transition-colors',
                on
                  ? 'border-accent bg-accent/10 text-fg'
                  : 'border-border bg-surface text-fg-subtle hover:text-fg'
              )}
            >
              {label}
            </button>
          )
        })}
      </div>
    </FormField>
  )
}

function BlackoutDatesForm({
  config,
  setConfig,
}: { config: Record<string, unknown>; setConfig: (c: Record<string, unknown>) => void }) {
  const [draft, setDraft] = useState('')
  const dates = (config.dates as string[] | undefined) ?? []
  const addDate = () => {
    if (!draft) return
    setConfig({ dates: [...dates, draft] })
    setDraft('')
  }
  const remove = (d: string) => setConfig({ dates: dates.filter((x) => x !== d) })
  return (
    <FormField label="Blackout dates" helper="Pick a date and click Add. Service will not run on these days.">
      <div className="flex gap-2">
        <Input type="date" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <Button type="button" variant="secondary" size="sm" onClick={addDate}>Add</Button>
      </div>
      {dates.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {dates.map((d) => (
            <span
              key={d}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-subtle px-2 py-1 text-xs"
            >
              <span className="font-tabular">{d}</span>
              <button
                type="button"
                onClick={() => remove(d)}
                className="text-fg-subtle hover:text-danger"
                aria-label={`Remove ${d}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </FormField>
  )
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function SeasonalWindowForm({
  config,
  setConfig,
}: { config: Record<string, unknown>; setConfig: (c: Record<string, unknown>) => void }) {
  const sm = (config.start_month as number | undefined) ?? 1
  const em = (config.end_month as number | undefined) ?? 12
  return (
    <div className="grid grid-cols-2 gap-3">
      <FormField label="Start month">
        <Select
          value={String(sm)}
          onValueChange={(v) => setConfig({ ...config, start_month: Number(v) })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {MONTHS.map((m, i) => (
              <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="End month" helper={sm > em ? 'Wraps around the year (Nov–Mar = Nov, Dec, Jan, Feb, Mar)' : undefined}>
        <Select
          value={String(em)}
          onValueChange={(v) => setConfig({ ...config, end_month: Number(v) })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {MONTHS.map((m, i) => (
              <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
    </div>
  )
}

function TimeWindowForm({
  config,
  setConfig,
}: { config: Record<string, unknown>; setConfig: (c: Record<string, unknown>) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <FormField label="Earliest start">
        <Input
          type="time"
          value={(config.earliest_start as string | undefined) ?? ''}
          onChange={(e) => setConfig({ ...config, earliest_start: e.target.value })}
        />
      </FormField>
      <FormField label="Latest end">
        <Input
          type="time"
          value={(config.latest_end as string | undefined) ?? ''}
          onChange={(e) => setConfig({ ...config, latest_end: e.target.value })}
        />
      </FormField>
    </div>
  )
}

const ACCESS_KINDS = [
  { value: 'badge', label: 'Badge required' },
  { value: 'escort', label: 'Escort required' },
  { value: 'key', label: 'Key required' },
  { value: 'code', label: 'Access code' },
  { value: 'other', label: 'Other' },
]

function AccessRequirementForm({
  config,
  setConfig,
}: { config: Record<string, unknown>; setConfig: (c: Record<string, unknown>) => void }) {
  return (
    <>
      <FormField label="Access kind">
        <Select
          value={(config.kind as string | undefined) ?? 'badge'}
          onValueChange={(v) => setConfig({ ...config, kind: v })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {ACCESS_KINDS.map((k) => (
              <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="Details (optional)">
        <Input
          value={(config.details as string | undefined) ?? ''}
          onChange={(e) => setConfig({ ...config, details: e.target.value })}
          placeholder="e.g. Pick up badge from front desk"
        />
      </FormField>
    </>
  )
}

function ContactRequirementForm({
  config,
  setConfig,
}: { config: Record<string, unknown>; setConfig: (c: Record<string, unknown>) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <FormField label="Contact name">
        <Input
          value={(config.contact_name as string | undefined) ?? ''}
          onChange={(e) => setConfig({ ...config, contact_name: e.target.value })}
        />
      </FormField>
      <FormField label="Contact phone">
        <Input
          value={(config.contact_phone as string | undefined) ?? ''}
          onChange={(e) => setConfig({ ...config, contact_phone: e.target.value })}
          placeholder="555-555-5555"
        />
      </FormField>
      <FormField label="Advance notice (hours)">
        <Input
          type="number"
          min={0}
          value={
            config.advance_notice_hours == null ? '' : String(config.advance_notice_hours)
          }
          onChange={(e) =>
            setConfig({
              ...config,
              advance_notice_hours: e.target.value === '' ? undefined : Number(e.target.value),
            })
          }
        />
      </FormField>
      <FormField label="Instructions" className="col-span-2">
        <Textarea
          value={(config.instructions as string | undefined) ?? ''}
          onChange={(e) => setConfig({ ...config, instructions: e.target.value })}
          placeholder="Anything the crew should know before arriving"
          rows={2}
        />
      </FormField>
    </div>
  )
}
