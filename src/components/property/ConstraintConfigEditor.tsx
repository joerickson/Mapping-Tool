// Per-type config sub-forms for service-location constraints. Used by:
//   - AddConstraintDialog (when adding a constraint to a single SL)
//   - EditTemplateDialog (when building a template)
//
// All forms take { config, setConfig } so the caller owns state. Validation
// happens server-side via api/_lib/analysis/constraint-validators.ts —
// these forms only enforce reasonable defaults and prevent obvious typos.
import { useState } from 'react'
import Button from '../ui/Button'
import { Input, Textarea, FormField } from '../ui/Input'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../ui/Select'
import { cn } from '../../lib/cn'
import type { ConstraintType } from './constraint-types'

export function defaultConfigForType(type: ConstraintType): Record<string, unknown> {
  switch (type) {
    case 'day_of_week':
      return { allowed_days: [1, 2, 3, 4, 5] }
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

export default function ConstraintConfigEditor({
  type,
  config,
  setConfig,
}: {
  type: ConstraintType
  config: Record<string, unknown>
  setConfig: (c: Record<string, unknown>) => void
}) {
  switch (type) {
    case 'day_of_week':
      return <DayOfWeekForm config={config} setConfig={setConfig} />
    case 'blackout_dates':
      return <BlackoutDatesForm config={config} setConfig={setConfig} />
    case 'seasonal_window':
      return <SeasonalWindowForm config={config} setConfig={setConfig} />
    case 'time_window':
      return <TimeWindowForm config={config} setConfig={setConfig} />
    case 'access_requirement':
      return <AccessRequirementForm config={config} setConfig={setConfig} />
    case 'contact_requirement':
      return <ContactRequirementForm config={config} setConfig={setConfig} />
  }
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
              aria-pressed={on}
              onClick={() => toggle(i)}
              className={cn(
                'flex-1 rounded-md border-2 px-2 py-2 text-xs font-medium transition-colors',
                on
                  ? 'border-accent bg-accent text-accent-fg'
                  : 'border-border bg-surface text-fg-subtle hover:border-border-strong hover:text-fg'
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
        <Select value={String(sm)} onValueChange={(v) => setConfig({ ...config, start_month: Number(v) })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {MONTHS.map((m, i) => (
              <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="End month" helper={sm > em ? 'Wraps around the year (Nov–Mar = Nov, Dec, Jan, Feb, Mar)' : undefined}>
        <Select value={String(em)} onValueChange={(v) => setConfig({ ...config, end_month: Number(v) })}>
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
        <Select value={(config.kind as string | undefined) ?? 'badge'} onValueChange={(v) => setConfig({ ...config, kind: v })}>
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
          value={config.advance_notice_hours == null ? '' : String(config.advance_notice_hours)}
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
