import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import Navbar from '../../components/ui/Navbar'
import type { Client } from '../../types'

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  prospect: 'bg-yellow-100 text-yellow-700',
  churned: 'bg-gray-100 text-gray-500',
}

export default function ClientsListPage() {
  const { getToken } = useAuth()
  const [clients, setClients] = useState<(Client & { service_location_count?: number; portfolio_count?: number })[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('active')
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const token = await getToken()
        const params = new URLSearchParams()
        if (statusFilter) params.set('status', statusFilter)
        if (search) params.set('search', search)
        const res = await fetch(`/api/v1/clients?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok && !cancelled) setClients(await res.json())
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    const t = setTimeout(load, search ? 300 : 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [statusFilter, search, getToken])

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <Navbar />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
            <Link
              to="/clients/new"
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              + New Client
            </Link>
          </div>

          {/* Filters */}
          <div className="flex gap-3 mb-6">
            <input
              type="text"
              placeholder="Search by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 max-w-xs border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="prospect">Prospect</option>
              <option value="churned">Churned</option>
            </select>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-gray-400 text-sm">Loading…</div>
            ) : clients.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <p className="text-gray-500">No clients found.</p>
                <Link to="/clients/new" className="text-blue-600 text-sm hover:underline">
                  Create your first client →
                </Link>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Contact</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {clients.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: c.brand_color ?? hashColor(c.id) }}
                          />
                          <div>
                            <Link to={`/clients/${c.id}`} className="font-medium text-gray-900 hover:text-blue-600">
                              {c.display_name ?? c.name}
                            </Link>
                            {c.display_name && (
                              <p className="text-xs text-gray-400">{c.name}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[c.status] ?? 'bg-gray-100 text-gray-500'}`}>
                          {c.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {c.primary_contact_name ?? '—'}
                        {c.primary_contact_email && (
                          <div className="text-xs">{c.primary_contact_email}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Link to={`/clients/${c.id}`} className="text-blue-600 hover:underline">
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

function hashColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
    hash |= 0
  }
  const h = Math.abs(hash) % 360
  return `hsl(${h}, 65%, 50%)`
}
