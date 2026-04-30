// Edit-address dialog. The 6 address fields are bundled because changing
// any of them re-validates and re-geocodes the property — doing one at a
// time would mean hitting the geocoder up to 6 times per address fix.
import { useState, useEffect } from 'react'
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

const ADDRESS_FIELDS = [
  { key: 'address_line1', label: 'Address line 1' },
  { key: 'address_line2', label: 'Address line 2' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'postal_code', label: 'Postal code' },
  { key: 'country', label: 'Country' },
] as const

type AddressKey = typeof ADDRESS_FIELDS[number]['key']

interface Props {
  open: boolean
  onClose: () => void
  propertyId: string
  current: Partial<Record<AddressKey, string | null | undefined>>
  onSaved: () => void
}

export default function AddressEditDialog({
  open,
  onClose,
  propertyId,
  current,
  onSaved,
}: Props) {
  const { getToken } = useAuth()
  const [draft, setDraft] = useState<Record<AddressKey, string>>(() => emptyDraft())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setDraft({
        address_line1: current.address_line1 ?? '',
        address_line2: current.address_line2 ?? '',
        city: current.city ?? '',
        state: current.state ?? '',
        postal_code: current.postal_code ?? '',
        country: current.country ?? 'US',
      })
      setError(null)
    }
  }, [open, current])

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/properties/${propertyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(draft),
      })
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
          <DialogTitle>Edit address</DialogTitle>
          <DialogDescription>
            Saving will re-validate the address against Google and update the map pin.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {ADDRESS_FIELDS.map((f) => (
            <FormField key={f.key} label={f.label} htmlFor={`addr-${f.key}`}>
              <Input
                id={`addr-${f.key}`}
                value={draft[f.key]}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
              />
            </FormField>
          ))}
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} loading={saving}>Save & re-geocode</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function emptyDraft(): Record<AddressKey, string> {
  return { address_line1: '', address_line2: '', city: '', state: '', postal_code: '', country: 'US' }
}
