// Edit a single service_location row. Phase 4b expands the editable
// surface from 5 fields to ~12 and surfaces cascading effects (which
// downstream modules will be marked stale by this save).
import { useState, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
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
import { Input, Textarea, FormField } from '../ui/Input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/Select'
import CustomFieldsEditor from './CustomFieldsEditor'
import { SERVICE_LOCATION_FIELDS, type FieldSpec } from '../../lib/editable-fields'
import type { ServiceLocation } from '../../types'

interface ServiceOffering {
  id: string
  name: string
}

interface Props {
  open: boolean
  onClose: () => void
  serviceLocation: ServiceLocation | null
  clientId: string
  onSaved: (cascade: SaveResult['cascading_effects']) => void
}

interface SaveResult {
  cascading_effects: {
    analyses_marked_stale: string[]
    synthesis_refresh_triggered: boolean
    comparables_invalidated: boolean
    reasons: Array<{ field: string; modules: string[]; explanation: string }>
  }
}

const STALE_THRESHOLD = 0.1

export default function ServiceLocationEditDialog({
  open,
  onClose,
  serviceLocation,
  clientId,
  onSaved,
}: Props) {
  const { getToken } = useAuth()
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offerings, setOfferings] = useState<ServiceOffering[]>([])

  useEffect(() => {
    if (open && serviceLocation) {
      const next: Record<string, unknown> = {}
      for (const f of SERVICE_LOCATION_FIELDS) {
        const v = (serviceLocation as unknown as Record<string, unknown>)[f.key]
        next[f.key] = v ?? (f.kind === 'custom_fields' ? {} : '')
      }
      setDraft(next)
      setReason('')
      setError(null)
    }
  }, [open, serviceLocation])

  // Load offerings for the service_offering_id select. /api/v1/service-offerings
  // is scoped to client_id.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    async function load() {
      try {
        const token = await getToken()
        const res = await fetch(`/api/v1/service-offerings?client_id=${clientId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return
        const data = (await res.json()) as ServiceOffering[]
        if (!cancelled) setOfferings(data)
      } catch {
        // Non-fatal — the select just shows the current id without label.
      }
    }
    load()
    return () => { cancelled = true }
  }, [open, clientId, getToken])

  if (!serviceLocation) return null

  const oldSqft = Number(serviceLocation.serviceable_sqft ?? 0)
  const newSqft = Number(draft.serviceable_sqft ?? 0)
  const sqftWillStale =
    oldSqft > 0 &&
    newSqft > 0 &&
    Math.abs(newSqft - oldSqft) / oldSqft >= STALE_THRESHOLD

  const offeringChanged =
    draft.service_offering_id != null &&
    draft.service_offering_id !== '' &&
    draft.service_offering_id !== (serviceLocation as any).service_offering_id

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const token = await getToken()
      const body: Record<string, unknown> = { ...draft }
      // Strip empty-string for nullable fields so the API doesn't write ''.
      for (const f of SERVICE_LOCATION_FIELDS) {
        if (f.kind !== 'custom_fields' && body[f.key] === '') body[f.key] = null
      }
      if (reason.trim()) body.edit_reason = reason.trim()

      const res = await fetch(
        `/api/v1/service-locations/${serviceLocation!.service_location_id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        }
      )
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error ?? `Save failed (${res.status})`)
      }
      const json = (await res.json()) as SaveResult
      onSaved(json.cascading_effects)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  function renderField(f: FieldSpec) {
    const id = `sl-${f.key}`
    const value = draft[f.key]

    if (f.kind === 'select') {
      const options =
        f.key === 'service_offering_id'
          ? offerings.map((o) => ({ value: o.id, label: o.name }))
          : f.options ?? []
      return (
        <Select
          value={String(value ?? '')}
          onValueChange={(v) => setDraft({ ...draft, [f.key]: v })}
        >
          <SelectTrigger id={id}><SelectValue placeholder="(none)" /></SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }
    if (f.kind === 'number') {
      return (
        <Input
          id={id}
          type="number"
          step="any"
          value={value == null ? '' : String(value)}
          onChange={(e) =>
            setDraft({
              ...draft,
              [f.key]: e.target.value === '' ? null : Number(e.target.value),
            })
          }
        />
      )
    }
    if (f.kind === 'textarea') {
      return (
        <Textarea
          id={id}
          value={(value as string | null | undefined) ?? ''}
          onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
          rows={3}
        />
      )
    }
    if (f.kind === 'custom_fields') {
      return (
        <CustomFieldsEditor
          value={(value as Record<string, unknown> | undefined) ?? {}}
          onChange={(next) => setDraft({ ...draft, [f.key]: next })}
        />
      )
    }
    return (
      <Input
        id={id}
        value={(value as string | null | undefined) ?? ''}
        onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
      />
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit service location</DialogTitle>
          <DialogDescription>
            {serviceLocation.display_name ?? serviceLocation.service_location_id}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {SERVICE_LOCATION_FIELDS.map((f) => (
            <FormField key={f.key} label={f.label} helper={f.helper} htmlFor={`sl-${f.key}`}>
              {renderField(f)}
            </FormField>
          ))}

          <FormField label="Reason (optional)" helper="Captured in the audit log next to this edit.">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Sqft corrected after walkthrough"
            />
          </FormField>

          {sqftWillStale && (
            <CascadeWarning
              text={
                `Sqft change of ` +
                `${Math.round((Math.abs(newSqft - oldSqft) / oldSqft) * 100)}%` +
                ` will mark Crew Strategy, Workforce Sizing, and Bid Pricing stale.`
              }
            />
          )}
          {offeringChanged && (
            <CascadeWarning text="Offering change reclassifies the work — all tier-2 modules will be marked stale and the comparables cache will be cleared." />
          )}

          {error && <p className="text-xs text-danger">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} loading={saving}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CascadeWarning({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-fg">
      <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
      <span>{text}</span>
    </div>
  )
}
