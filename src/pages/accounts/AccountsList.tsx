import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import Navbar from '../../components/ui/Navbar'
import type { Account } from '../../types'

const TYPE_BADGE: Record<string, string> = {
  self_managed: 'bg-blue-100 text-blue-700',
  property_manager: 'bg-purple-100 text-purple-700',
}
const TYPE_LABEL: Record<string, string> = {
  self_managed: 'Self-Managed',
  property_manager: 'Property Manager',
}

interface AccountRow extends Account {
  client_count?: number
  service_location_count?: number
}

export default function AccountsListPage() {
  const { getToken } = useAuth()
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const abortTimeout = setTimeout(() => controller.abort(), 10000)

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const token = await getToken()
        const params = new URLSearchParams()
        if (search) params.set('search', search)
        const res = await fetch(`/api/v1/accounts?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`Server error (${res.status})`)
        if (!cancelled) setAccounts(await res.json())
      } catch (err) {
        if (!cancelled) {
          const isTimeout = err instanceof DOMException && err.name === 'AbortError'
          setError(
            isTimeout
              ? 'Request timed out — the server is taking too long to respond.'
              : err instanceof Error ? err.message : 'Failed to load accounts'
          )
        }
      } finally {
        clearTimeout(abortTimeout)
        if (!cancelled) setLoading(false)
      }
    }

    const debounce = setTimeout(load, search ? 300 : 0)
    return () => {
      cancelled = true
      clearTimeout(debounce)
      clearTimeout(abortTimeout)
      controller.abort()
    }
  }, [search, getToken, retryCount])

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <Navbar />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
            <Link
              to="/accounts/new"
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              + New Account
            </Link>
          </div>

          <div className="flex gap-3 mb-6">
            <input
              type="text"
              placeholder="Search by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 max-w-xs border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-gray-400 text-sm">Loading…</div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <p className="text-red-600 text-sm">{error}</p>
                <button
                  onClick={() => setRetryCount((c) => c + 1)}
                  className="text-blue-600 text-sm hover:underline"
                >
                  Retry
                </button>
              </div>
            ) : accounts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <p className="text-gray-500">No accounts yet — create your first account</p>
                <Link to="/accounts/new" className="text-blue-600 text-sm hover:underline">
                  Create your first account →
                </Link>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Type</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Contact</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {accounts.map((a) => (
                    <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <Link to={`/accounts/${a.id}`} className="font-medium text-gray-900 hover:text-blue-600">
                          {a.display_name ?? a.name}
                        </Link>
                        {a.display_name && <p className="text-xs text-gray-400">{a.name}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_BADGE[a.account_type] ?? 'bg-gray-100 text-gray-500'}`}>
                          {TYPE_LABEL[a.account_type] ?? a.account_type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${a.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {a.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {a.primary_contact_name ?? '—'}
                        {a.primary_contact_email && <div>{a.primary_contact_email}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <Link to={`/accounts/${a.id}`} className="text-blue-600 hover:underline text-xs">
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
