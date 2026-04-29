import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import Navbar from '../../components/ui/Navbar'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'

interface UploadBatch {
  upload_batch_id: string
  source_filename: string | null
  status: string
  total_rows: number | null
  rows_processed: number | null
  errors_count: number | null
  summary_stats: {
    committed_new_properties?: number
    committed_new_service_locations?: number
    [key: string]: unknown
  } | null
  created_at: string
  committed_at: string | null
  account_id: string | null
  client_id: string | null
  account_name: string | null
  client_name: string | null
}

type RowState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; properties: number; service_locations: number }
  | { status: 'error'; message: string; failed_rows: unknown[]; expanded: boolean }

const STATUS_COLORS: Record<string, string> = {
  parsed: 'bg-gray-100 text-gray-700',
  processing: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-blue-100 text-blue-700',
  committed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
}

export default function AdminUploadsPage() {
  const { getToken } = useAuth()
  const [batches, setBatches] = useState<UploadBatch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmBatch, setConfirmBatch] = useState<UploadBatch | null>(null)
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({})

  useEffect(() => {
    fetchBatches()
  }, [])

  async function fetchBatches() {
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/admin/upload-batches', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error ?? 'Failed to load batches')
      }
      const { batches: data } = await res.json()
      setBatches(data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load batches')
    } finally {
      setLoading(false)
    }
  }

  function setRowState(batchId: string, state: RowState) {
    setRowStates((prev) => ({ ...prev, [batchId]: state }))
  }

  async function handleCommit(batch: UploadBatch) {
    setConfirmBatch(null)
    setRowState(batch.upload_batch_id, { status: 'loading' })
    try {
      const token = await getToken()
      const res = await fetch('/api/admin/recommit-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ batch_id: batch.upload_batch_id }),
      })
      const data = await res.json()
      if (!res.ok) {
        const failedRows = data.failed_rows ?? []
        setRowState(batch.upload_batch_id, {
          status: 'error',
          message: data.error ?? `${failedRows.length} rows failed`,
          failed_rows: failedRows,
          expanded: false,
        })
        return
      }
      const failedRows = data.failed_rows ?? []
      if (failedRows.length > 0 && (data.new_properties ?? 0) === 0) {
        setRowState(batch.upload_batch_id, {
          status: 'error',
          message: `${failedRows.length} rows failed`,
          failed_rows: failedRows,
          expanded: false,
        })
        return
      }
      setRowState(batch.upload_batch_id, {
        status: 'success',
        properties: data.new_properties ?? 0,
        service_locations: data.new_service_locations ?? 0,
      })
      // Refresh batch list to show updated status/counts
      fetchBatches()
    } catch (err) {
      setRowState(batch.upload_batch_id, {
        status: 'error',
        message: err instanceof Error ? err.message : 'Commit failed',
        failed_rows: [],
        expanded: false,
      })
    }
  }

  function toggleExpanded(batchId: string) {
    setRowStates((prev) => {
      const s = prev[batchId]
      if (s?.status === 'error') return { ...prev, [batchId]: { ...s, expanded: !s.expanded } }
      return prev
    })
  }

  function renderAction(batch: UploadBatch) {
    const rowState = rowStates[batch.upload_batch_id] ?? { status: 'idle' }

    if (rowState.status === 'loading') {
      return (
        <span className="inline-flex items-center gap-1.5 text-sm text-gray-500">
          <svg className="animate-spin h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Recommitting...
        </span>
      )
    }

    if (rowState.status === 'success') {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium bg-green-100 text-green-700 px-2 py-1 rounded-full">
          ✓ Committed: {rowState.properties} properties, {rowState.service_locations} service_locations
        </span>
      )
    }

    if (rowState.status === 'error') {
      return (
        <div className="space-y-1">
          <button
            onClick={() => toggleExpanded(batch.upload_batch_id)}
            className="inline-flex items-center gap-1 text-xs font-medium bg-red-100 text-red-700 px-2 py-1 rounded-full hover:bg-red-200"
          >
            {rowState.failed_rows.length > 0
              ? `${rowState.failed_rows.length} rows failed — click for details`
              : rowState.message}
          </button>
          {rowState.expanded && rowState.failed_rows.length > 0 && (
            <div className="mt-1 max-h-40 overflow-y-auto bg-red-50 border border-red-200 rounded p-2 text-xs text-red-800 font-mono whitespace-pre-wrap">
              {JSON.stringify(rowState.failed_rows, null, 2)}
            </div>
          )}
        </div>
      )
    }

    const { status, summary_stats } = batch
    const committedProps = summary_stats?.committed_new_properties

    if (status === 'completed') {
      return (
        <Button size="sm" variant="primary" onClick={() => setConfirmBatch(batch)}>
          Commit
        </Button>
      )
    }

    if (status === 'committed' && (committedProps == null || committedProps === 0)) {
      return (
        <Button size="sm" variant="secondary" onClick={() => setConfirmBatch(batch)}>
          Recommit
        </Button>
      )
    }

    if (status === 'committed' && committedProps != null && committedProps > 0) {
      return (
        <Link
          to={`/uploads/${batch.upload_batch_id}/summary`}
          className="text-sm text-blue-600 hover:underline"
        >
          View Details
        </Link>
      )
    }

    if (status === 'failed' || status === 'cancelled') {
      return (
        <Link
          to={`/uploads/${batch.upload_batch_id}/summary`}
          className="text-sm text-gray-500 hover:underline"
        >
          Details
        </Link>
      )
    }

    if (status === 'processing') {
      return (
        <span className="inline-flex items-center gap-1.5 text-sm text-gray-500">
          <svg className="animate-spin h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {batch.rows_processed ?? 0} of {batch.total_rows ?? '?'} rows
        </span>
      )
    }

    return null
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <Navbar />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
          <div className="flex items-center gap-3 mb-2">
            <Link to="/admin" className="text-gray-400 hover:text-gray-600 text-sm">← Admin</Link>
            <h1 className="text-2xl font-bold text-gray-900">Admin — Upload Batches</h1>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <svg className="animate-spin h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-red-700 text-sm">{error}</div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      <th className="px-4 py-3">Created</th>
                      <th className="px-4 py-3">File</th>
                      <th className="px-4 py-3">Account</th>
                      <th className="px-4 py-3">Client</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Total / Proc / Errs</th>
                      <th className="px-4 py-3 text-right">Props / SLs</th>
                      <th className="px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {batches.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-gray-400">No batches found</td>
                      </tr>
                    ) : batches.map((batch) => {
                      const rowState = rowStates[batch.upload_batch_id] ?? { status: 'idle' }
                      const isActionRow = rowState.status !== 'idle'
                      return (
                        <tr key={batch.upload_batch_id} className={isActionRow ? 'bg-gray-50' : 'hover:bg-gray-50'}>
                          <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                            {new Date(batch.created_at).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 max-w-[200px] truncate text-gray-900" title={batch.source_filename ?? ''}>
                            {batch.source_filename ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-gray-700">{batch.account_name ?? '—'}</td>
                          <td className="px-4 py-3 text-gray-700">{batch.client_name ?? '—'}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[batch.status] ?? 'bg-gray-100 text-gray-600'}`}>
                              {batch.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600 tabular-nums">
                            {batch.total_rows ?? '—'} / {batch.rows_processed ?? '—'} / {batch.errors_count ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600 tabular-nums">
                            {batch.summary_stats?.committed_new_properties != null
                              ? `${batch.summary_stats.committed_new_properties} / ${batch.summary_stats.committed_new_service_locations ?? 0}`
                              : '—'}
                          </td>
                          <td className="px-4 py-3">{renderAction(batch)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={confirmBatch !== null}
        onClose={() => setConfirmBatch(null)}
        title="Confirm Recommit"
        size="sm"
      >
        {confirmBatch && (
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              This will reset batch <strong>{confirmBatch.source_filename ?? confirmBatch.upload_batch_id}</strong> and re-run the commit step.
            </p>
            <p className="text-sm text-gray-700">
              Status will be reset from <strong>{confirmBatch.status}</strong> to <strong>completed</strong> before commit runs.
            </p>
            <p className="text-sm text-gray-700">Continue?</p>
            <div className="flex gap-3 justify-end pt-2">
              <Button variant="secondary" onClick={() => setConfirmBatch(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => handleCommit(confirmBatch)}>
                Confirm
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
