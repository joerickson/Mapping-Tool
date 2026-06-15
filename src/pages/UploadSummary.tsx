import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import AppShell from '../components/layout/AppShell'
import FailedRowsEditor from '../components/upload/FailedRowsEditor'
import type { UploadSummaryStats } from '../types'

interface SummaryData {
  batch_id: string
  status: string
  source_filename: string
  total_rows: number
  committed_at: string | null
  summary_stats: UploadSummaryStats | null
}

export default function UploadSummaryPage() {
  const { batchId } = useParams<{ batchId: string }>()
  const { getToken } = useAuth()
  const [data, setData] = useState<SummaryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [retryMsg, setRetryMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!batchId) return
    let mounted = true

    async function load() {
      try {
        const token = await getToken()
        const [statusRes, previewRes] = await Promise.all([
          fetch(`/api/uploads/${batchId}/status`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`/api/uploads/${batchId}/preview`, { headers: { Authorization: `Bearer ${token}` } }),
        ])

        if (!statusRes.ok) throw new Error('Batch not found')
        const statusData = await statusRes.json()
        const previewData = previewRes.ok ? await previewRes.json() : {}

        if (!mounted) return
        setData({
          batch_id: batchId!,
          status: statusData.status,
          source_filename: previewData.source_filename ?? 'Upload',
          total_rows: statusData.total_rows ?? 0,
          committed_at: null,
          summary_stats: statusData.summary_stats ?? null,
        })
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    load()
    return () => { mounted = false }
  }, [batchId, getToken])

  async function handleRetry() {
    if (!batchId) return
    setRetrying(true)
    setRetryMsg(null)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/uploads/${batchId}/commit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? `Retry failed: ${res.status}`)
      setRetryMsg(
        `Retry committed ${j.new_properties ?? 0} new properties + ${j.new_service_locations ?? 0} new service locations.`
      )
      // Reload status so the cards reflect the merged totals.
      const statusRes = await fetch(`/api/uploads/${batchId}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (statusRes.ok) {
        const statusData = await statusRes.json()
        setData((prev) => (prev ? { ...prev, summary_stats: statusData.summary_stats ?? prev.summary_stats } : prev))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed')
    } finally {
      setRetrying(false)
    }
  }

  async function reloadStatus() {
    if (!batchId) return
    const token = await getToken()
    const statusRes = await fetch(`/api/uploads/${batchId}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (statusRes.ok) {
      const statusData = await statusRes.json()
      setData((prev) =>
        prev
          ? { ...prev, status: statusData.status, summary_stats: statusData.summary_stats ?? prev.summary_stats }
          : prev
      )
    }
  }

  return (
    <AppShell breadcrumb={[{ label: 'Upload', to: '/upload' }, { label: 'Summary' }]}>
      <div className="mx-auto max-w-3xl px-6 py-10">
          {loading && (
            <div className="flex items-center gap-3 text-gray-500">
              <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              Loading…
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>
          )}

          {data && (
            <div className="space-y-6">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-2xl">✅</span>
                    <h1 className="text-2xl font-bold text-gray-900">Import Complete</h1>
                  </div>
                  <p className="text-sm text-gray-500">{data.source_filename}</p>
                </div>
                <Link
                  to="/map"
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                >
                  View on Map →
                </Link>
              </div>

              {/* Stats */}
              {data.summary_stats && (
                <div className="bg-white rounded-xl p-6 shadow-sm border space-y-4">
                  <h2 className="font-semibold text-gray-800">Summary</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <StatCard
                      label="Total rows processed"
                      value={data.summary_stats.total}
                      color="gray"
                    />
                    <StatCard
                      label="Valid"
                      value={data.summary_stats.valid}
                      color="green"
                    />
                    <StatCard
                      label="Auto-corrected"
                      value={data.summary_stats.corrected}
                      color="yellow"
                    />
                    <StatCard
                      label="Skipped (invalid)"
                      value={data.summary_stats.invalid}
                      color="red"
                    />
                    <StatCard
                      label="Duplicates (skipped)"
                      value={data.summary_stats.duplicate_within_batch}
                      color="blue"
                    />
                    <StatCard
                      label="Matched existing"
                      value={data.summary_stats.duplicate_existing}
                      color="blue"
                    />
                  </div>

                  {(data.summary_stats.committed_new_properties != null) && (
                    <div className="border-t pt-4 space-y-2">
                      <h3 className="text-sm font-medium text-gray-700">Created / Updated</h3>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 bg-green-50 rounded-lg">
                          <div className="text-xl font-bold text-green-700">
                            {data.summary_stats.committed_new_properties?.toLocaleString() ?? 0}
                          </div>
                          <div className="text-xs text-green-600">New properties</div>
                        </div>
                        <div className="p-3 bg-blue-50 rounded-lg">
                          <div className="text-xl font-bold text-blue-700">
                            {data.summary_stats.committed_new_service_locations?.toLocaleString() ?? 0}
                          </div>
                          <div className="text-xs text-blue-600">New service locations</div>
                        </div>
                        {(data.summary_stats.committed_existing_properties ?? 0) > 0 && (
                          <div className="p-3 bg-gray-50 rounded-lg">
                            <div className="text-xl font-bold text-gray-700">
                              {data.summary_stats.committed_existing_properties?.toLocaleString()}
                            </div>
                            <div className="text-xs text-gray-500">Existing properties linked</div>
                          </div>
                        )}
                        {(data.summary_stats.committed_updated_service_locations ?? 0) > 0 && (
                          <div className="p-3 bg-gray-50 rounded-lg">
                            <div className="text-xl font-bold text-gray-700">
                              {data.summary_stats.committed_updated_service_locations?.toLocaleString()}
                            </div>
                            <div className="text-xs text-gray-500">Service locations updated</div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Commit failures / retry — surfaces when a prior commit
                  errored out partway (Vercel timeout, transient DB error).
                  The commit endpoint is now idempotent so re-running it
                  picks up only the rows that didn't make it. */}
              {((data.summary_stats?.commit_failure_count ?? 0) > 0 ||
                data.status === 'completed') && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-amber-900">
                        {data.status === 'completed'
                          ? 'Commit did not finish'
                          : `${data.summary_stats?.commit_failure_count ?? 0} rows failed to commit`}
                      </p>
                      <p className="text-xs text-amber-800">
                        Re-running the commit picks up only the rows that didn't get
                        in last time. Already-committed rows are skipped automatically
                        — you won't get duplicates.
                      </p>
                      <FailedRowsEditor
                        batchId={batchId!}
                        getToken={getToken}
                        onRecommitted={reloadStatus}
                      />
                      {retryMsg && (
                        <p className="text-xs text-green-700 font-medium mt-1">{retryMsg}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleRetry}
                      disabled={retrying}
                      className="shrink-0 px-3 py-1.5 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50"
                    >
                      {retrying ? 'Retrying…' : 'Retry commit'}
                    </button>
                  </div>
                </div>
              )}

              {/* Error download */}
              {(data.summary_stats?.invalid ?? 0) > 0 && (
                <div className="bg-white rounded-xl p-4 shadow-sm border flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      {data.summary_stats!.invalid} invalid rows were skipped
                    </p>
                    <p className="text-xs text-gray-500">Download the error report to review and correct them.</p>
                  </div>
                  <DownloadErrorsButton batchId={batchId!} getToken={getToken} />
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                <Link
                  to="/upload"
                  className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Upload Another File
                </Link>
                <Link
                  to="/map"
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                >
                  View Map
                </Link>
              </div>
            </div>
          )}
      </div>
    </AppShell>
  )
}

function DownloadErrorsButton({ batchId, getToken }: { batchId: string; getToken: () => Promise<string | null> }) {
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
      className="px-3 py-2 text-sm text-blue-600 border border-blue-300 rounded-lg hover:bg-blue-50 disabled:opacity-50"
    >
      {downloading ? 'Downloading…' : 'Download Errors CSV'}
    </button>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: 'green' | 'yellow' | 'red' | 'blue' | 'gray' }) {
  const colorClass = {
    green: 'text-green-600',
    yellow: 'text-yellow-600',
    red: 'text-red-600',
    blue: 'text-blue-600',
    gray: 'text-gray-700',
  }[color]
  return (
    <div className="flex flex-col p-3 bg-gray-50 rounded-lg">
      <span className={`text-xl font-bold ${colorClass}`}>{value.toLocaleString()}</span>
      <span className="text-xs text-gray-500 mt-0.5">{label}</span>
    </div>
  )
}
