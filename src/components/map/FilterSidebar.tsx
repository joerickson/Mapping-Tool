import { useState, useEffect } from 'react'
import { useAuth } from '@clerk/clerk-react'
import type { MapFilter, RbmCategory, ServiceLocationStatus } from '../../types'
import { STATUS_LABELS } from '../../lib/constants'

interface FilterSidebarProps {
  filter: MapFilter
  onChange: (filter: MapFilter) => void
}

const STATUSES: ServiceLocationStatus[] = ['active', 'paused', 'terminated', 'prospect']

export default function FilterSidebar({ filter, onChange }: FilterSidebarProps) {
  const { getToken } = useAuth()
  const [categories, setCategories] = useState<RbmCategory[]>([])
  const [clients, setClients] = useState<{ client_id: string; name: string }[]>([])
  const [portfolios, setPortfolios] = useState<{ portfolio_id: string; name: string }[]>([])

  useEffect(() => {
    async function load() {
      const token = await getToken()
      const headers = { Authorization: `Bearer ${token}` }
      const [catsRes, clientsRes, portsRes] = await Promise.all([
        fetch('/api/v1/categories', { headers }),
        fetch('/api/v1/clients', { headers }),
        fetch('/api/v1/portfolios', { headers }),
      ])
      if (catsRes.ok) setCategories(await catsRes.json())
      if (clientsRes.ok) setClients(await clientsRes.json())
      if (portsRes.ok) setPortfolios(await portsRes.json())
    }
    load()
  }, [getToken])

  const toggleMulti = (key: keyof MapFilter, value: string) => {
    const arr = filter[key] as string[]
    onChange({
      ...filter,
      [key]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value],
    })
  }

  const clearAll = () =>
    onChange({ clients: [], categories: [], cityState: '', statuses: [], portfolios: [] })

  const hasActive =
    filter.clients.length > 0 ||
    filter.categories.length > 0 ||
    filter.cityState !== '' ||
    filter.statuses.length > 0 ||
    filter.portfolios.length > 0

  return (
    <div className="w-72 bg-white border-r flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <h2 className="font-semibold text-gray-800">Filters</h2>
        {hasActive && (
          <button onClick={clearAll} className="text-xs text-blue-600 hover:underline">
            Clear all
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
        {/* City / State text filter */}
        <section>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
            City / State
          </label>
          <input
            type="text"
            placeholder="e.g. Chicago, IL"
            value={filter.cityState}
            onChange={(e) => onChange({ ...filter, cityState: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </section>

        {/* Status */}
        <section>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
            Status
          </label>
          <div className="space-y-1.5">
            {STATUSES.map((s) => (
              <label key={s} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filter.statuses.includes(s)}
                  onChange={() => toggleMulti('statuses', s)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">{STATUS_LABELS[s]}</span>
              </label>
            ))}
          </div>
        </section>

        {/* Categories */}
        {categories.length > 0 && (
          <section>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Category
            </label>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {categories.map((c) => (
                <label key={c.code} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filter.categories.includes(c.code)}
                    onChange={() => toggleMulti('categories', c.code)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: c.color ?? '#9ca3af' }}
                  />
                  <span className="text-sm text-gray-700">{c.label}</span>
                </label>
              ))}
            </div>
          </section>
        )}

        {/* Client */}
        {clients.length > 0 && (
          <section>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Client
            </label>
            <div className="space-y-1.5 max-h-36 overflow-y-auto">
              {clients.map((c) => (
                <label key={c.client_id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filter.clients.includes(c.client_id)}
                    onChange={() => toggleMulti('clients', c.client_id)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700 truncate">{c.name}</span>
                </label>
              ))}
            </div>
          </section>
        )}

        {/* Portfolio */}
        {portfolios.length > 0 && (
          <section>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Portfolio
            </label>
            <div className="space-y-1.5 max-h-36 overflow-y-auto">
              {portfolios.map((p) => (
                <label key={p.portfolio_id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filter.portfolios.includes(p.portfolio_id)}
                    onChange={() => toggleMulti('portfolios', p.portfolio_id)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700 truncate">{p.name}</span>
                </label>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
