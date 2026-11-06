// Admin-only dialog to relocate a client to a different account. Calls
// POST /api/v1/clients/:id/move. On a 409 name_conflict it reveals a rename
// field and resubmits with new_name.
import { useEffect, useRef, useState } from 'react'
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
import { Input, FormField } from '../ui/Input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/Select'
import { toast } from '../ui/Toast'

interface AccountOption {
  id: string
  name: string
  display_name?: string | null
  account_type?: string
  status?: string
}

interface Props {
  open: boolean
  onClose: () => void
  client: { id: string; name: string; account_id: string }
  onMoved?: (toAccountId: string) => void | Promise<void>
}

export default function MoveClientDialog({ open, onClose, client, onMoved }: Props) {
  const { getToken } = useAuth()
  const [accounts, setAccounts] = useState<AccountOption[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [targetId, setTargetId] = useState('')
  const [conflict, setConflict] = useState(false)
  const [newName, setNewName] = useState(client.name)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  // Latest client/getToken, read at open time so background changes don't reset the form.
  const latest = useRef({ client, getToken })
  latest.current = { client, getToken }

  // Reset + load target accounts whenever the dialog opens.
  useEffect(() => {
    if (!open) return
    const { client: c, getToken: gt } = latest.current
    setTargetId('')
    setConflict(false)
    setNewName(c.name)
    setError(null)
    let cancelled = false
    ;(async () => {
      setLoadingAccounts(true)
      try {
        const token = await gt()
        const res = await fetch('/api/v1/accounts', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error(`Failed to load accounts: ${res.status}`)
        const list = (await res.json()) as AccountOption[]
        if (!cancelled) {
          setAccounts(list.filter((a) => a.id !== c.account_id && a.status === 'active'))
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoadingAccounts(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, client.id])

  // Focus the rename input when the conflict prompt appears.
  useEffect(() => {
    if (conflict) nameRef.current?.focus()
  }, [conflict])

  const submit = async () => {
    if (!targetId) {
      setError('Choose a target account')
      return
    }
    if (conflict && !newName.trim()) {
      setError('A new name is required')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const token = await getToken()
      const body: { target_account_id: string; new_name?: string } = {
        target_account_id: targetId,
      }
      if (conflict) body.new_name = newName.trim()
      const res = await fetch(`/api/v1/clients/${client.id}/move`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      })
      const j = (await res.json().catch(() => ({}))) as Record<string, any>
      if (res.status === 409 && j.error === 'name_conflict') {
        setConflict(true)
        setError(
          `The target account already has a client named "${j.conflicting_name ?? newName}". Choose a different name.`,
        )
        return
      }
      if (!res.ok) {
        throw new Error(
          j.error === 'invalid_target_account'
            ? 'That target account is not valid'
            : j.error === 'client_not_found'
              ? 'Client not found'
              : (j.error ?? `Move failed: ${res.status}`),
        )
      }
      toast.success('Client moved', {
        description: j.final_name && j.final_name !== client.name ? `Now named "${j.final_name}" in the target account.` : undefined,
      })
      if (typeof j.stragglers === 'number' && j.stragglers > 0) {
        toast.error('Some records were not moved', {
          description: `${j.stragglers} straggler record(s) were written during the move. Re-run the move to sweep them.`,
          durationMs: 10000,
        })
      }
      if (j.stragglers_check_incomplete === true) {
        toast.error('Move verification incomplete', {
          description: 'The post-move check for leftover records could not complete. Verify the client data in the target account.',
          durationMs: 10000,
        })
      }
      await onMoved?.(targetId)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !submitting && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Move to another account</DialogTitle>
          <DialogDescription>
            This client will use the target account's shared service offerings and pricing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <FormField label="Target account">
            <Select
              value={targetId}
              onValueChange={(v) => {
                setTargetId(v)
                setConflict(false)
                setNewName(client.name)
                setError(null)
              }}
              disabled={loadingAccounts || submitting}
            >
              <SelectTrigger>
                <SelectValue placeholder={loadingAccounts ? 'Loading…' : 'Select an account'} />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.display_name ?? a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          {conflict && (
            <FormField
              label="New name for this client in the target account"
              helper="The target account already has a client with that name."
            >
              <Input
                ref={nameRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                disabled={submitting}
              />
            </FormField>
          )}
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !targetId} loading={submitting}>
            {conflict ? 'Rename and move' : 'Move client'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
