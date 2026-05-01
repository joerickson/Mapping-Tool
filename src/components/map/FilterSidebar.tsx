import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useClient } from '../../context/ClientContext'
import { Input } from '../ui/Input'
import type { MapFilter, ServiceLocationStatus, Client } from '../../types'
import { STATUS_LABELS } from '../../lib/constants'

interface FilterSidebarProps {
  filter: MapFilter
  onChange: (filter: MapFilter) => void
}

interface CustomFieldDef {
  id: string
  field_key: string
  field_label: string
  field_type: 'text' | 'number' | 'date' | 'select'
  select_options: string[] | null
  client_id: string | null
  appears_in_filters: boolean
  sort_order: number
}

const STATUSES: ServiceLocationStatus[] = ['active', 'paused', 'terminated', 'prospect']

export default function FilterSidebar({ filter, onChange }: FilterSidebarProps) {
  const { getToken } = useAuth()
  const { clients: allClients } = useClient()
  const [portfolios, setPortfolios] = useState<{ portfolio_id: string; name: string }[]>([])
  const [customDefs, setCustomDefs] = useState<CustomFieldDef[]>([])

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

  // Custom-field defs are per-client. When clients are selected, union the
  // filterable defs across those clients. With no client filter, hide the
  // section (custom fields are noise without a scope).
  useEffect(() => {
    let cancelled = false
    async function loadCustom() {
      if (filter.clients.length === 0) {
        setCustomDefs([])
        return
      }
      const token = await getToken()
      const headers = { Authorization: `Bearer ${token}` }
      const all: CustomFieldDef[] = []
      const seen = new Set<string>()
      for (const cid of filter.clients) {
        try {
          const res = await fetch(
            `/api/v1/custom-field-definitions?client_id=${cid}`,
            { headers }
          )
          if (!res.ok) continue
          const defs = (await res.json()) as CustomFieldDef[]
          for (const d of defs) {
            if (!d.appears_in_filters) continue
            if (seen.has(d.field_key)) continue
            seen.add(d.field_key)
            all.push(d)
          }
        } catch {
          // ignore — partial result is fine
        }
      }
      if (!cancelled) {
        all.sort((a, b) => a.sort_order - b.sort_order || a.field_label.localeCompare(b.field_label))
        setCustomDefs(all)
      }
    }
    loadCustom()
    return () => {
      cancelled = true
    }
  }, [filter.clients, getToken])

  const customFilter = filter.custom ?? {}

  const setCustomText = (key: string, value: string) => {
    const next = { ...customFilter }
    if (value.trim() === '') delete next[key]
    else next[key] = value
    onChange({ ...filter, custom: next })
  }

  const toggleCustomSelect = (key: string, value: string) => {
    const next = { ...customFilter }
    const cur = next[key]
    const arr = Array.isArray(cur) ? cur : []
    const has = arr.includes(value)
    const updated = has ? arr.filter((v) => v !== value) : [...arr, value]
    if (updated.length === 0) delete next[key]
    else next[key] = updated
    onChange({ ...filter, custom: next })
  }

  const hasActiveCustom = useMemo(
    () => Object.keys(customFilter).length > 0,
    [customFilter]
  )

  const toggleMulti = (key: keyof MapFilter, value: string) => {
    const arr = filter[key] as string[]
    onChange({
      ...filter,
      [key]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value],
    })
  }

  const clearAll = () =>
    onChange({ clients: [], cityState: '', statuses: [], portfolios: [], custom: {} })

  const hasActive =
    filter.clients.length > 0 ||
    filter.cityState !== '' ||
    filter.statuses.length > 0 ||
    filter.portfolios.length > 0 ||
    hasActiveCustom

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

        {/* Custom fields — only when a client is selected (defs are per-client). */}
        {customDefs.map((def) => {
          const value = customFilter[def.field_key]
          if (def.field_type === 'select') {
            const options = def.select_options ?? []
            const selected = Array.isArray(value) ? value : []
            return (
              <FilterGroup key={def.id} label={def.field_label}>
                <ul className="max-h-36 space-y-1 overflow-y-auto pr-1">
                  {options.length === 0 ? (
                    <li className="text-xs text-fg-subtle italic">No options defined.</li>
                  ) : (
                    options.map((opt) => (
                      <FilterOption
                        key={opt}
                        checked={selected.includes(opt)}
                        onToggle={() => toggleCustomSelect(def.field_key, opt)}
                        label={opt}
                      />
                    ))
                  )}
                </ul>
              </FilterGroup>
            )
          }
          // text / number / date — single text input with contains-match
          // semantics. Number/date refinement (range) is a follow-up.
          return (
            <FilterGroup key={def.id} label={def.field_label}>
              <Input
                type={def.field_type === 'date' ? 'date' : 'text'}
                placeholder={def.field_type === 'number' ? 'Match contains…' : 'Contains…'}
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => setCustomText(def.field_key, e.target.value)}
              />
            </FilterGroup>
          )
        })}
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
