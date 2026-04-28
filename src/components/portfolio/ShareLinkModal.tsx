import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import Modal from '../ui/Modal'
import Button from '../ui/Button'

interface ShareLinkModalProps {
  open: boolean
  onClose: () => void
  portfolioId: string
  existingToken?: string | null
}

export default function ShareLinkModal({
  open,
  onClose,
  portfolioId,
  existingToken,
}: ShareLinkModalProps) {
  const { getToken } = useAuth()
  const [token, setToken] = useState(existingToken ?? null)
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  const shareUrl = token
    ? `${import.meta.env.VITE_APP_URL}/portfolio/${token}`
    : null

  const generate = async () => {
    setGenerating(true)
    try {
      const authToken = await getToken()
      const res = await fetch(`/api/v1/portfolios/${portfolioId}/share`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      })
      if (res.ok) {
        const data = await res.json()
        setToken(data.share_token)
      }
    } finally {
      setGenerating(false)
    }
  }

  const copy = () => {
    if (!shareUrl) return
    navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Modal open={open} onClose={onClose} title="Share Portfolio" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Generate a read-only share link for this portfolio. No login required to view.
        </p>
        {token ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={shareUrl ?? ''}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-700"
              />
              <Button size="sm" variant="secondary" onClick={copy}>
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
            <Button size="sm" variant="ghost" onClick={generate} loading={generating}>
              Regenerate link
            </Button>
          </div>
        ) : (
          <Button onClick={generate} loading={generating}>
            Generate Share Link
          </Button>
        )}
      </div>
    </Modal>
  )
}
