// Admin-only dialog to generate/copy/regenerate a public, read-only share link
// for a client's map. Calls POST /api/v1/clients/:id/share. Link format:
// ${VITE_APP_URL}/client-map/<token>.
import { useEffect, useState } from 'react'
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
import { Input } from '../ui/Input'

interface Props {
  open: boolean
  onClose: () => void
  client: { id: string; name: string; share_token?: string | null }
}

export default function ClientShareModal({ open, onClose, client }: Props) {
  const { getToken } = useAuth()
  const [token, setToken] = useState<string | null>(client.share_token ?? null)
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-sync only when the client (or its persisted token) changes; the modal
  // stays mounted, so a token generated here survives close/reopen even though
  // the parent's client object is not refetched.
  useEffect(() => {
    setToken(client.share_token ?? null)
    setCopied(false)
    setError(null)
  }, [client.id, client.share_token])

  const shareUrl = token ? `${import.meta.env.VITE_APP_URL}/client-map/${token}` : ''

  const generate = async () => {
    setGenerating(true)
    setError(null)
    try {
      const authToken = await getToken()
      const res = await fetch(`/api/v1/clients/${client.id}/share`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      })
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      const data = await res.json()
      setToken(data.share_token)
      setCopied(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate link')
    } finally {
      setGenerating(false)
    }
  }

  const copy = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy to clipboard')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share map</DialogTitle>
          <DialogDescription>
            Generate a read-only link to {client.name}'s map. Anyone with the link can view it
            without logging in.
          </DialogDescription>
        </DialogHeader>

        {token ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Input readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} />
              <Button variant="secondary" onClick={copy}>
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
            <Button variant="ghost" onClick={generate} loading={generating}>
              Regenerate link
            </Button>
            <p className="text-xs text-muted-foreground">
              Regenerating invalidates the previous link.
            </p>
          </div>
        ) : (
          <Button onClick={generate} loading={generating}>
            Generate share link
          </Button>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
