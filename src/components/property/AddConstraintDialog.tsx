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
import { Textarea, FormField } from '../ui/Input'
import { cn } from '../../lib/cn'
import {
  CONSTRAINT_LABELS,
  CONSTRAINT_DESCRIPTIONS,
  CONSTRAINT_GROUPS,
  type ConstraintType,
} from './constraint-types'
import ConstraintConfigEditor, { defaultConfigForType } from './ConstraintConfigEditor'
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
  const [config, setConfig] = useState<Record<string, unknown>>(() => defaultConfigForType('day_of_week'))
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset config when type changes
  function changeType(next: ConstraintType) {
    setType(next)
    setConfig(defaultConfigForType(next))
  }

  function reset() {
    setServiceLocationId(serviceLocations[0]?.service_location_id ?? '')
    setType('day_of_week')
    setEnforcement('hard')
    setConfig(defaultConfigForType('day_of_week'))
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

          <ConstraintConfigEditor type={type} config={config} setConfig={setConfig} />

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

