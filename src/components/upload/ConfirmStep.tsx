import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { UploadSummaryStats } from '../../types'

interface Props {
  batchId: string
  stats: UploadSummaryStats
  onCancelled: () => void
  onBack: () => void
  getToken: () => Promise<string | null>
}

export default function ConfirmStep({ batchId, stats, onCancelled, onBack, getToken }: Props) {
  const navigate = useNavigate()
  const [committing, setCommitting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const validRows = stats.valid + stats.corrected
  const existingMatched = stats.duplicate_existing

  const handleCommit = async () => {
    setCommitting(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/uploads/${batchId}/commit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: 'Commit failed' }))
        throw new Error(json.error ?? 'Commit failed')
      }
      navigate(`/uploads/${batchId}/summary`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Commit failed')
      setCommitting(false)
    }
  }

  const handleCancel = async () => {
    if (!confirm('Cancel this upload? All staged data will be discarded.')) return
    setCancelling(true)
    try {
      const token = await getToken()
      await fetch(`/api/uploads/${batchId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      onCancelled()
    } catch {
      // ignore
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl p-6 shadow-sm border">
        <h2 className="font-semibold text-gray-800 mb-4">Confirm Import</h2>
        <p className="text-sm text-gray-500 mb-6">Review what will be created before confirming.</p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <SummaryRow
            icon="🏢"
            label="Properties"
            description={
              existingMatched > 0
                ? `~${validRows - existingMatched} new · ${existingMatched} existing matched`
                : `~${validRows} new`
            }
          />
          <SummaryRow
            icon="📍"
            label="Service locations"
            description={`~${validRows + existingMatched} will be created or updated`}
          />
          {stats.corrected > 0 && (
            <SummaryRow
              icon="✏️"
              label="Auto-corrected rows"
              description={`${stats.corrected} rows had address corrections applied`}
            />
          )}
          {stats.invalid > 0 && (
            <SummaryRow
              icon="⚠️"
              label="Invalid rows skipped"
              description={`${stats.invalid} rows will not be imported`}
              warn
            />
          )}
        </div>
      </div>

      <div className="flex justify-between">
        <div className="flex gap-3">
          <button
            onClick={onBack}
            disabled={committing || cancelling}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40"
          >
            Back
          </button>
          <button
            onClick={handleCancel}
            disabled={committing || cancelling}
            className="px-4 py-2 text-sm text-red-600 border border-red-300 rounded-lg hover:bg-red-50 disabled:opacity-40"
          >
            {cancelling ? 'Cancelling…' : 'Cancel Upload'}
          </button>
        </div>
        <button
          onClick={handleCommit}
          disabled={committing || cancelling || validRows + existingMatched === 0}
          className="px-6 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {committing ? 'Importing…' : 'Confirm & Import'}
        </button>
      </div>
    </div>
  )
}

function SummaryRow({ icon, label, description, warn }: { icon: string; label: string; description: string; warn?: boolean }) {
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg ${warn ? 'bg-yellow-50' : 'bg-gray-50'}`}>
      <span className="text-lg">{icon}</span>
      <div>
        <div className={`text-sm font-medium ${warn ? 'text-yellow-800' : 'text-gray-800'}`}>{label}</div>
        <div className={`text-sm ${warn ? 'text-yellow-700' : 'text-gray-500'}`}>{description}</div>
      </div>
    </div>
  )
}
