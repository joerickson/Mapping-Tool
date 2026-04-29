import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import Navbar from '../../components/ui/Navbar'
import Button from '../../components/ui/Button'

const RESET_PHRASE = 'delete all data'

export default function DangerousAdminPage() {
  const { getToken } = useAuth()
  const [phrase, setPhrase] = useState('')
  const [resetting, setResetting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string; performed_at?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleReset() {
    if (phrase !== RESET_PHRASE) return
    setResetting(true)
    setError(null)
    setResult(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/v1/admin/dangerous', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: 'reset_service_location_data',
          confirmation: phrase,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Reset failed')
      setResult({ ok: true, message: body.message, performed_at: body.performed_at })
      setPhrase('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed')
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <Navbar />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
          <div className="flex items-center gap-3 mb-2">
            <Link to="/admin" className="text-gray-400 hover:text-gray-600 text-sm">← Admin</Link>
            <h1 className="text-2xl font-bold text-gray-900">Admin — Dangerous Actions</h1>
          </div>

          <div className="bg-red-50 border border-red-200 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-5 h-5 text-red-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <h2 className="font-semibold text-red-800">Reset All Data</h2>
            </div>
            <p className="text-sm text-red-700 mb-4">
              This permanently deletes <strong>all</strong> accounts, clients, service offerings, custom fields, upload templates,
              properties, service locations, upload batches, staged addresses, and portfolios.
              This action cannot be undone.
            </p>

            {result ? (
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
                <p className="font-medium">{result.message}</p>
                {result.performed_at && (
                  <p className="text-xs mt-1">{new Date(result.performed_at).toLocaleString()}</p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-medium text-red-700">
                  Type <span className="font-mono bg-red-100 px-1 rounded">{RESET_PHRASE}</span> to confirm:
                </p>
                <input
                  type="text"
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  placeholder={RESET_PHRASE}
                  className="w-full border border-red-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 bg-white"
                />
                {error && <p className="text-sm text-red-700">{error}</p>}
                <Button
                  variant="danger"
                  loading={resetting}
                  disabled={phrase !== RESET_PHRASE}
                  onClick={handleReset}
                >
                  Reset All Data
                </Button>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm border p-5">
            <h2 className="font-semibold text-gray-800 mb-2">Other Admin Pages</h2>
            <ul className="space-y-1 text-sm">
              <li><Link to="/admin/uploads" className="text-blue-600 hover:underline">Upload Batches</Link></li>
              <li><Link to="/admin/parcels/import" className="text-blue-600 hover:underline">Parcel Import</Link></li>
              <li><Link to="/admin/parcels/counties" className="text-blue-600 hover:underline">County Library</Link></li>
              <li><Link to="/admin/parcels/fallbacks" className="text-blue-600 hover:underline">Parcel Fallbacks</Link></li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
