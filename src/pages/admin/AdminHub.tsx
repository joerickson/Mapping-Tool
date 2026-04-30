import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import AppShell from '../../components/layout/AppShell'
import Button from '../../components/ui/Button'

interface EnrichmentStats {
  total: number
  pending: number
  enriched: number
  failed: number
  [key: string]: number
}

type EnrichState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; total: number; succeeded: number; failed: number }
  | { status: 'error'; message: string }

export default function AdminHubPage() {
  const { getToken } = useAuth()
  const [stats, setStats] = useState<EnrichmentStats | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [enrichState, setEnrichState] = useState<EnrichState>({ status: 'idle' })
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function fetchStats() {
    try {
      const token = await getToken()
      const res = await fetch('/api/admin/enrichment-stats', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load stats')
      setStats(await res.json())
      setStatsError(null)
    } catch (err) {
      setStatsError(err instanceof Error ? err.message : 'Failed to load stats')
    }
  }

  useEffect(() => {
    fetchStats()
  }, [])

  function startPoll() {
    if (pollRef.current) return
    pollRef.current = setInterval(fetchStats, 3000)
  }

  function stopPoll() {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  useEffect(() => {
    return () => stopPoll()
  }, [])

  async function handleEnrichPending() {
    setEnrichState({ status: 'running' })
    startPoll()
    try {
      const token = await getToken()
      const res = await fetch('/api/admin/enrich-pending', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      stopPoll()
      await fetchStats()
      if (!res.ok) {
        setEnrichState({ status: 'error', message: data.error ?? 'Enrichment failed' })
        return
      }
      if (data.message === 'No pending properties') {
        setEnrichState({ status: 'done', total: 0, succeeded: 0, failed: 0 })
        return
      }
      setEnrichState({
        status: 'done',
        total: data.total ?? 0,
        succeeded: data.succeeded ?? 0,
        failed: data.failed ?? 0,
      })
    } catch (err) {
      stopPoll()
      setEnrichState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Enrichment failed',
      })
    }
  }

  const isRunning = enrichState.status === 'running'

  return (
    <AppShell breadcrumb={[{ label: 'Admin' }]}>
      <div className="mx-auto max-w-4xl px-6 py-10 space-y-6">
          <div className="flex items-center gap-3 mb-2">
            <Link to="/map" className="text-gray-400 hover:text-gray-600 text-sm">← Map</Link>
            <h1 className="text-2xl font-bold text-gray-900">Admin</h1>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Upload Batches card */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-gray-900">Upload Batches</h2>
              </div>
              <p className="text-sm text-gray-500 mb-4">
                Manage committed and pending upload batches, re-run commits, and view batch details.
              </p>
              <Link
                to="/admin/uploads"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-800"
              >
                View Upload Batches →
              </Link>
            </div>

            {/* Property Enrichment card */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-gray-900">Property Enrichment</h2>
              </div>

              {/* Stats */}
              {statsError ? (
                <p className="text-sm text-red-600 mb-4">{statsError}</p>
              ) : stats ? (
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[
                    { label: 'Pending', value: stats.pending, color: 'text-yellow-700 bg-yellow-50' },
                    { label: 'Enriched', value: stats.enriched, color: 'text-green-700 bg-green-50' },
                    { label: 'Failed', value: stats.failed, color: 'text-red-700 bg-red-50' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className={`rounded-lg px-3 py-2 text-center ${color}`}>
                      <div className="text-xl font-bold">{value}</div>
                      <div className="text-xs font-medium">{label}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-16 flex items-center justify-center mb-4">
                  <svg className="animate-spin h-5 w-5 text-gray-300" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
              )}

              {/* Run state feedback */}
              {enrichState.status === 'running' && (
                <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 rounded-lg px-3 py-2 mb-3">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Enriching properties… stats update every 3 s
                </div>
              )}
              {enrichState.status === 'done' && (
                <div className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2 mb-3">
                  {enrichState.total === 0
                    ? 'No pending properties found.'
                    : `Done — ${enrichState.succeeded} succeeded, ${enrichState.failed} failed out of ${enrichState.total}.`}
                </div>
              )}
              {enrichState.status === 'error' && (
                <div className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2 mb-3">
                  Error: {enrichState.message}
                </div>
              )}

              <Button
                size="sm"
                variant="primary"
                loading={isRunning}
                disabled={isRunning}
                onClick={handleEnrichPending}
              >
                Enrich Pending Properties
              </Button>
            </div>
          </div>

          {/* Other admin links */}
          <div className="bg-white rounded-xl shadow-sm border p-5">
            <h2 className="font-semibold text-gray-800 mb-2">Other Admin Tools</h2>
            <ul className="space-y-1 text-sm">
              <li><Link to="/admin/dangerous" className="text-blue-600 hover:underline">Dangerous Actions</Link></li>
              <li><Link to="/admin/parcels/import" className="text-blue-600 hover:underline">Parcel Import</Link></li>
              <li><Link to="/admin/parcels/counties" className="text-blue-600 hover:underline">County Library</Link></li>
              <li><Link to="/admin/parcels/fallbacks" className="text-blue-600 hover:underline">Parcel Fallbacks</Link></li>
            </ul>
          </div>
      </div>
    </AppShell>
  )
}
