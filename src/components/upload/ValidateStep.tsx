import { useEffect, useRef, useCallback, useState } from 'react'
import type { BatchStatusResponse, UploadSummaryStats } from '../../types'

interface Props {
  batchId: string
  batchStatus: BatchStatusResponse | null
  onStatusUpdate: (status: BatchStatusResponse) => void
  onBack: () => void
  onNext: () => void
  getToken: () => Promise<string | null>
}

function DownloadErrorsButton({ batchId, count, getToken }: { batchId: string; count: number; getToken: () => Promise<string | null> }) {
  const [downloading, setDownloading] = useState(false)

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const token = await getToken()
      const res = await fetch(`/api/uploads/${batchId}/errors`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `errors_${batchId}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <button
      onClick={handleDownload}
      disabled={downloading}
      className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline disabled:opacity-50"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      {downloading ? 'Downloading…' : `Download ${count} invalid rows as CSV`}
    </button>
  )
}

export default function ValidateStep({
  batchId,
  batchStatus,
  onStatusUpdate,
  onBack,
  onNext,
  getToken,
}: Props) {
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [lostConnection, setLostConnection] = useState(false)

  const status = batchStatus?.status ?? 'processing'
  const totalRows = batchStatus?.total_rows ?? 0
  const rowsProcessed = batchStatus?.rows_processed ?? 0
  const pct = totalRows > 0 ? Math.round((rowsProcessed / totalRows) * 100) : 0
  const currentSheet = batchStatus?.current_sheet ?? null
  const errorsCount = batchStatus?.errors_count ?? batchStatus?.validation_errors_count ?? 0
  const stats = batchStatus?.summary_stats ?? null

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  const pollStatus = useCallback(async () => {
    try {
      const token = await getToken()
      const res = await fetch(`/api/uploads/${batchId}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) { setLostConnection(true); return }
      setLostConnection(false)
      const data: BatchStatusResponse = await res.json()
      onStatusUpdate(data)
      if (data.status === 'completed' || data.status === 'failed' || data.status === 'committed') {
        stopPolling()
      }
    } catch {
      setLostConnection(true)
    }
  }, [batchId, getToken, onStatusUpdate, stopPolling])

  useEffect(() => {
    if (status === 'completed' || status === 'failed') return
    pollRef.current = setInterval(pollStatus, 2000)
    pollStatus()
    return () => stopPolling()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => stopPolling(), [stopPolling])

  const validCount = (stats?.valid ?? 0) + (stats?.corrected ?? 0)
  const canProceed = validCount > 0

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl p-6 shadow-sm border">
        <h2 className="font-semibold text-gray-800 mb-4">
          {status === 'completed' ? 'Validation Complete' : 'Validating…'}
        </h2>

        {lostConnection && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
            Lost connection — your upload is still processing in the background. Refresh to check status.
          </div>
        )}

        {status !== 'completed' && status !== 'failed' && (
          <div className="space-y-3">
            <div className="flex justify-between text-sm text-gray-600">
              <span>
                {rowsProcessed.toLocaleString()} of {totalRows.toLocaleString()} rows
                {currentSheet && <> · <span className="text-gray-500">Sheet: {currentSheet}</span></>}
              </span>
              <span>{pct}%</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2.5">
              <div
                className="bg-blue-600 h-2.5 rounded-full transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            {errorsCount > 0 && (
              <p className="text-sm text-red-600">{errorsCount} errors found so far…</p>
            )}
            <p className="text-sm text-gray-400">Processing in background — you can navigate away safely.</p>
          </div>
        )}

        {status === 'failed' && (
          <div className="p-4 bg-red-50 rounded-lg text-red-700 text-sm">
            Processing failed: {batchStatus?.error ?? 'Unknown error'}
          </div>
        )}

        {status === 'completed' && stats && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard label="Total" value={stats.total} color="gray" />
              <StatCard label="Valid" value={stats.valid} color="green" />
              <StatCard label="Auto-corrected" value={stats.corrected} color="yellow" />
              <StatCard label="Invalid" value={stats.invalid} color="red" />
            </div>

            {(stats.duplicate_within_batch > 0 || stats.duplicate_existing > 0) && (
              <div className="flex gap-4 pt-1">
                {stats.duplicate_within_batch > 0 && (
                  <span className="text-sm text-blue-600">
                    {stats.duplicate_within_batch} duplicate{stats.duplicate_within_batch !== 1 ? 's' : ''} within batch (skipped)
                  </span>
                )}
                {stats.duplicate_existing > 0 && (
                  <span className="text-sm text-blue-600">
                    {stats.duplicate_existing} matched existing propert{stats.duplicate_existing !== 1 ? 'ies' : 'y'}
                  </span>
                )}
              </div>
            )}

            {stats.invalid > 0 && (
              <DownloadErrorsButton batchId={batchId} count={stats.invalid} getToken={getToken} />
            )}
          </div>
        )}
      </div>

      <div className="flex justify-between">
        <button
          onClick={onBack}
          disabled={status === 'processing'}
          className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!canProceed || status !== 'completed'}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Proceed to Final Step
        </button>
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: 'green' | 'yellow' | 'red' | 'gray' }) {
  const colorClass = {
    green: 'text-green-600',
    yellow: 'text-yellow-600',
    red: 'text-red-600',
    gray: 'text-gray-700',
  }[color]
  return (
    <div className="flex flex-col p-3 bg-gray-50 rounded-lg">
      <span className={`text-2xl font-bold ${colorClass}`}>{value.toLocaleString()}</span>
      <span className="text-xs text-gray-500 mt-0.5">{label}</span>
    </div>
  )
}
