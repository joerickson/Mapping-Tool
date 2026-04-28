import { useState, useEffect } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useClient } from '../../context/ClientContext'
import type { MapFilter, ServiceLocationStatus, Client } from '../../types'
import { STATUS_LABELS } from '../../lib/constants'

interface FilterSidebarProps {
  filter: MapFilter
  onChange: (filter: MapFilter) => void
}

const STATUSES: ServiceLocationStatus[] = ['active', 'paused', 'terminated', 'prospect']

export default function FilterSidebar({ filter, onChange }: FilterSidebarProps) {
  const { getToken } = useAuth()
  const { clients: allClients } = useClient()
  const [portfolios, setPortfolios] = useState<{ portfolio_id: string; name: string }[]>([])

  // Only show active+prospect clients in filter
  const clients = allClients.filter((c) => c.status !== 'churned')

  useEffect(() => {
    async function load() {
      const token = await getToken()
      const headers = { Authorization: `Bearer ${token}` }
      const [portsResult] = await Promise.allSettled([
        fetch('/api/v1/portfolios', { headers }),
      ])
      if (portsResult.status === 'fulfilled' && portsResult.value.ok) {
        setPortfolios(await portsResult.value.json())
      } else if (portsResult.status === 'rejected') {
        console.error('Failed to load portfolios:', portsResult.reason)
      }
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
    onChange({ clients: [], cityState: '', statuses: [], portfolios: [] })

  const hasActive =
    filter.clients.length > 0 ||
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

        {/* Client */}
        {clients.length > 0 && (
          <section>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Client
            </label>
            <div className="space-y-1.5 max-h-36 overflow-y-auto">
              {clients.map((c: Client) => (
                <label key={c.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filter.clients.includes(c.id)}
                    onChange={() => toggleMulti('clients', c.id)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: c.brand_color ?? hashColor(c.id) }}
                  />
                  <span className="text-sm text-gray-700 truncate">{c.display_name ?? c.name}</span>
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

function hashColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
    hash |= 0
  }
  const h = Math.abs(hash) % 360
  return `hsl(${h}, 65%, 50%)`
}
