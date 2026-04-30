// Inline edit dialog for a client's identity + contact fields. Hits
// the same PATCH /api/v1/clients/{id} endpoint as the standalone
// /clients/{id} edit page, so changes persist + cascade identically.
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog'
import Button from '../ui/Button'
import { Input, FormField, Textarea } from '../ui/Input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/Select'

export type ClientStatus = 'active' | 'prospect' | 'churned'

export interface EditableClient {
  id: string
  name: string
  display_name?: string | null
  status: ClientStatus
  primary_contact_name?: string | null
  primary_contact_email?: string | null
  primary_contact_phone?: string | null
  notes?: string | null
  brand_color?: string | null
}

interface Props {
  open: boolean
  onClose: () => void
  client: EditableClient
  // Called with the freshly-saved client so the parent can update state
  // without a separate fetch.
  onSaved?: (updated: EditableClient) => void
}

export default function ClientEditDialog({ open, onClose, client, onSaved }: Props) {
  const { getToken } = useAuth()
  const [name, setName] = useState(client.name)
  const [displayName, setDisplayName] = useState(client.display_name ?? '')
  const [status, setStatus] = useState<ClientStatus>(client.status)
  const [contactName, setContactName] = useState(client.primary_contact_name ?? '')
  const [contactEmail, setContactEmail] = useState(client.primary_contact_email ?? '')
  const [contactPhone, setContactPhone] = useState(client.primary_contact_phone ?? '')
  const [notes, setNotes] = useState(client.notes ?? '')
  const [brandColor, setBrandColor] = useState(client.brand_color ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset form whenever a different client opens or after a save closes
  // and re-opens.
  useEffect(() => {
    if (!open) return
    setName(client.name)
    setDisplayName(client.display_name ?? '')
    setStatus(client.status)
    setContactName(client.primary_contact_name ?? '')
    setContactEmail(client.primary_contact_email ?? '')
    setContactPhone(client.primary_contact_phone ?? '')
    setNotes(client.notes ?? '')
    setBrandColor(client.brand_color ?? '')
    setError(null)
  }, [open, client])

  const save = async () => {
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const token = await getToken()
      const body = {
        name: name.trim(),
        display_name: displayName.trim() || null,
        status,
        primary_contact_name: contactName.trim() || null,
        primary_contact_email: contactEmail.trim() || null,
        primary_contact_phone: contactPhone.trim() || null,
        notes: notes.trim() || null,
        brand_color: brandColor || null,
      }
      const res = await fetch(`/api/v1/clients/${client.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as any).error ?? `Save failed: ${res.status}`)
      }
      const updated = (await res.json()) as EditableClient
      onSaved?.(updated)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit client</DialogTitle>
          <DialogDescription>
            Update the client's name, status, and contact info. Changes save immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <FormField label="Name *">
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </FormField>
          <FormField label="Display name (optional)" helper="Shown to users instead of the legal name when present.">
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Status">
              <Select value={status} onValueChange={(v) => setStatus(v as ClientStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="prospect">Prospect</SelectItem>
                  <SelectItem value="churned">Churned</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Brand color">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={brandColor || '#3b82f6'}
                  onChange={(e) => setBrandColor(e.target.value)}
                  className="h-9 w-12 rounded border border-border bg-surface cursor-pointer"
                />
                <Input
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  placeholder="#3b82f6"
                />
              </div>
            </FormField>
          </div>
          <FormField label="Primary contact name">
            <Input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Email">
              <Input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
              />
            </FormField>
            <FormField label="Phone">
              <Input
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
              />
            </FormField>
          </div>
          <FormField label="Notes">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </FormField>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving} loading={saving}>
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Saving…
              </>
            ) : (
              'Save changes'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
