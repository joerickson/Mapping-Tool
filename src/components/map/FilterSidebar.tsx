import { useState, useEffect } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useClient } from '../../context/ClientContext'
import { Input } from '../ui/Input'
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
    <div className="hidden md:flex w-64 shrink-0 flex-col h-full overflow-hidden border-r border-border bg-surface-subtle">
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <h2 className="text-sm font-semibold tracking-tight text-fg">Filters</h2>
        {hasActive && (
          <button
            onClick={clearAll}
            className="text-xs text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm px-1"
          >
            Clear all
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {/* City / State text filter */}
        <FilterGroup label="City / State">
          <Input
            type="text"
            placeholder="e.g. Chicago, IL"
            value={filter.cityState}
            onChange={(e) => onChange({ ...filter, cityState: e.target.value })}
          />
        </FilterGroup>

        {/* Status */}
        <FilterGroup label="Status">
          <ul className="space-y-1">
            {STATUSES.map((s) => (
              <FilterOption
                key={s}
                checked={filter.statuses.includes(s)}
                onToggle={() => toggleMulti('statuses', s)}
                label={STATUS_LABELS[s]}
              />
            ))}
          </ul>
        </FilterGroup>

        {/* Client */}
        {clients.length > 0 && (
          <FilterGroup label="Client">
            <ul className="max-h-36 space-y-1 overflow-y-auto pr-1">
              {clients.map((c: Client) => (
                <FilterOption
                  key={c.id}
                  checked={filter.clients.includes(c.id)}
                  onToggle={() => toggleMulti('clients', c.id)}
                  label={c.display_name ?? c.name}
                  swatch={c.brand_color ?? hashColor(c.id)}
                />
              ))}
            </ul>
          </FilterGroup>
        )}

        {/* Portfolio */}
        {portfolios.length > 0 && (
          <FilterGroup label="Portfolio">
            <ul className="max-h-36 space-y-1 overflow-y-auto pr-1">
              {portfolios.map((p) => (
                <FilterOption
                  key={p.portfolio_id}
                  checked={filter.portfolios.includes(p.portfolio_id)}
                  onToggle={() => toggleMulti('portfolios', p.portfolio_id)}
                  label={p.name}
                />
              ))}
            </ul>
          </FilterGroup>
        )}
      </div>
    </div>
  )
}

function FilterGroup({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
        {label}
      </h3>
      {children}
    </section>
  )
}

function FilterOption({
  checked,
  onToggle,
  label,
  swatch,
}: {
  checked: boolean
  onToggle: () => void
  label: string
  swatch?: string
}) {
  return (
    <li>
      <label className="flex cursor-pointer items-center gap-2 rounded-md py-0.5 hover:bg-surface-muted">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="h-3.5 w-3.5 rounded-sm border-border-strong accent-accent"
        />
        {swatch && (
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-border"
            style={{ backgroundColor: swatch }}
          />
        )}
        <span className="truncate text-sm text-fg">{label}</span>
      </label>
    </li>
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
