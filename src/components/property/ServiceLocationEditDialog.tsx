// Edit a single service_location row. Surfaces the >10% sqft warning so
// the user knows their edit will mark Crew Strategy stale.
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
import { Input, FormField } from '../ui/Input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/Select'
import { SERVICE_LOCATION_FIELDS } from '../../lib/editable-fields'
import type { ServiceLocation } from '../../types'

interface Props {
  open: boolean
  onClose: () => void
  serviceLocation: ServiceLocation | null
  onSaved: () => void
}

const STALE_THRESHOLD = 0.1

export default function ServiceLocationEditDialog({
  open,
  onClose,
  serviceLocation,
  onSaved,
}: Props) {
  const { getToken } = useAuth()
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open && serviceLocation) {
      const next: Record<string, unknown> = {}
      for (const f of SERVICE_LOCATION_FIELDS) {
        next[f.key] = (serviceLocation as unknown as Record<string, unknown>)[f.key] ?? ''
      }
      setDraft(next)
      setError(null)
    }
  }, [open, serviceLocation])

  if (!serviceLocation) return null

  const oldSqft = Number(serviceLocation.serviceable_sqft ?? 0)
  const newSqft = Number(draft.serviceable_sqft ?? 0)
  const sqftWillStale =
    oldSqft > 0 &&
    newSqft > 0 &&
    Math.abs(newSqft - oldSqft) / oldSqft >= STALE_THRESHOLD

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(
        `/api/v1/service-locations/${serviceLocation!.service_location_id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(draft),
        }
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Save failed (${res.status})`)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit service location</DialogTitle>
          <DialogDescription>{serviceLocation.display_name ?? serviceLocation.service_location_id}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {SERVICE_LOCATION_FIELDS.map((f) => (
            <FormField key={f.key} label={f.label} helper={f.helper} htmlFor={`sl-${f.key}`}>
              {f.kind === 'select' ? (
                <Select
                  value={String(draft[f.key] ?? '')}
                  onValueChange={(v) => setDraft({ ...draft, [f.key]: v })}
                >
                  <SelectTrigger id={`sl-${f.key}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {f.options?.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : f.kind === 'number' ? (
                <Input
                  id={`sl-${f.key}`}
                  type="number"
                  value={draft[f.key] == null ? '' : String(draft[f.key])}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      [f.key]: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                />
              ) : (
                <Input
                  id={`sl-${f.key}`}
                  value={(draft[f.key] as string | null | undefined) ?? ''}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                />
              )}
            </FormField>
          ))}

          {sqftWillStale && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-fg">
              <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              <span>
                Sqft change of{' '}
                <span className="font-tabular">
                  {Math.round((Math.abs(newSqft - oldSqft) / oldSqft) * 100)}%
                </span>{' '}
                will mark Crew Strategy as stale.
              </span>
            </div>
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
