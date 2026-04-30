import { useState, useEffect, useMemo, useCallback } from 'react'
import { CheckCheck, Loader2 } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useClient } from '../context/ClientContext'
import MapView from '../components/map/MapView'
import FilterSidebar from '../components/map/FilterSidebar'
import PropertyDetailPanel from '../components/map/PropertyDetailPanel'
import BulkSelectMenu from '../components/map/BulkSelectMenu'
import Button from '../components/ui/Button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/Dialog'
import { FormField, Input } from '../components/ui/Input'
import AppShell from '../components/layout/AppShell'
import { cn } from '../lib/cn'
import type { Property, ServiceLocation, MapFilter, PropertyWithLocations } from '../types'

const DEFAULT_FILTER: MapFilter = {
  clients: [],
  cityState: '',
  statuses: [],
  portfolios: [],
}

export default function MapPage() {
  const { getToken } = useAuth()
  const { clients, selectedClientId } = useClient()
  const [propertiesWithLocations, setPropertiesWithLocations] = useState<PropertyWithLocations[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<MapFilter>(DEFAULT_FILTER)
  const [selectedProperty, setSelectedProperty] = useState<PropertyWithLocations | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [bulkSelectMode, setBulkSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [portfolioModalOpen, setPortfolioModalOpen] = useState(false)
  const [portfolioName, setPortfolioName] = useState('')
  const [savingPortfolio, setSavingPortfolio] = useState(false)

  // Build a client color map for pin coloring
  const clientColorMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const c of clients) {
      map[c.id] = c.brand_color ?? hashColor(c.id)
    }
    return map
  }, [clients])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const token = await getToken()
        const buildParams = (offset: number) => {
          const params = new URLSearchParams()
          // Apply nav-level client switcher as a filter baseline
          const effectiveClients = filter.clients.length
            ? filter.clients
            : selectedClientId
            ? [selectedClientId]
            : []
          if (effectiveClients.length) params.set('client_id', effectiveClients.join(','))
          if (filter.statuses.length) params.set('status', filter.statuses.join(','))
          if (filter.portfolios.length) params.set('portfolio_id', filter.portfolios.join(','))
          if (filter.cityState) params.set('city_state', filter.cityState)
          params.set('limit', '2000')
          params.set('offset', String(offset))
          return params
        }

        // Paginate until has_more=false. PostgREST silently caps page size
        // (typically at ~1000 rows even when limit=2000 is requested), so
        // for portfolios over the cap we MUST loop pages — otherwise the
        // map silently drops properties (the IFS Utah bug).
        const all: PropertyWithLocations[] = []
        let offset = 0
        // Hard ceiling on requests so a runaway server response doesn't
        // turn into a 50-page client loop.
        const MAX_PAGES = 25
        for (let page = 0; page < MAX_PAGES; page++) {
          if (cancelled) return
          const res = await fetch(`/api/v1/properties?${buildParams(offset)}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (!res.ok) break
          const data = await res.json()
          const batch: PropertyWithLocations[] = data.properties ?? []
          all.push(...batch)
          if (!data.has_more || batch.length === 0) break
          offset += batch.length
        }
        if (!cancelled) setPropertiesWithLocations(all)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [filter, getToken, selectedClientId])

  const pins = useMemo(
    () =>
      propertiesWithLocations
        .filter((p) => p.property_id != null)
        .map((p) => ({
          property: p as Property,
          locations: p.service_locations,
          clientColor: p.service_locations?.[0]?.client_id
            ? (clientColorMap[p.service_locations[0].client_id] ?? null)
            : null,
        })),
    [propertiesWithLocations, clientColorMap]
  )

  const handlePinClick = useCallback(
    (pin: { property: Property; locations: ServiceLocation[] }) => {
      if (bulkSelectMode) {
        setSelectedIds((prev) => {
          const next = new Set(prev)
          if (next.has(pin.property.property_id)) {
            next.delete(pin.property.property_id)
          } else {
            next.add(pin.property.property_id)
          }
          return next
        })
      } else {
        setSelectedProperty(pin.property as PropertyWithLocations)
        setPanelOpen(true)
      }
    },
    [bulkSelectMode]
  )

  const handleExportCsv = () => {
    const selected = propertiesWithLocations.filter((p) => selectedIds.has(p.property_id))
    const rows = selected.flatMap((p) =>
      p.service_locations.map((loc) => ({
        property_id: p.property_id,
        address: p.address_line1,
        city: p.city,
        state: p.state,
        postal_code: p.postal_code,
        category: p.rbm_category ?? '',
        service_location_id: loc.service_location_id,
        display_name: loc.display_name ?? '',
        status: loc.status,
        serviceable_sqft: loc.serviceable_sqft ?? '',
      }))
    )
    const header = Object.keys(rows[0] ?? {}).join(',')
    const body = rows.map((r) => Object.values(r).join(',')).join('\n')
    const blob = new Blob([header + '\n' + body], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'rbm-geo-export.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleCreatePortfolio = async () => {
    if (!portfolioName.trim()) return
    setSavingPortfolio(true)
    try {
      const token = await getToken()
      await fetch('/api/v1/portfolios', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: portfolioName.trim(),
          property_ids: Array.from(selectedIds),
        }),
      })
      setPortfolioModalOpen(false)
      setPortfolioName('')
      setSelectedIds(new Set())
      setBulkSelectMode(false)
    } finally {
      setSavingPortfolio(false)
    }
  }

  return (
    <AppShell fullBleed>
      <div className="flex h-full overflow-hidden relative">
        <FilterSidebar filter={filter} onChange={setFilter} />

        <div className="flex-1 relative">
          {loading && (
            <div
              role="status"
              aria-live="polite"
              className="absolute inset-0 z-20 flex items-center justify-center bg-surface/60 backdrop-blur-sm"
            >
              <div className="flex items-center gap-2 text-sm text-fg-muted">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Loading properties…
              </div>
            </div>
          )}

          <MapView
            pins={pins}
            onPinClick={handlePinClick}
            bulkSelectMode={bulkSelectMode}
            selectedIds={selectedIds}
            filter={filter}
            showClientColors={!selectedClientId && clients.length > 1}
          />

          {/* Bulk select toggle */}
          <div className="absolute top-4 left-4 z-10">
            <button
              onClick={() => {
                setBulkSelectMode((v) => !v)
                setSelectedIds(new Set())
              }}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors',
                'border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                bulkSelectMode
                  ? 'border-accent bg-accent text-accent-fg hover:bg-accent-hover'
                  : 'border-border bg-surface text-fg hover:bg-surface-muted hover:border-border-strong'
              )}
            >
              {bulkSelectMode && <CheckCheck className="h-3.5 w-3.5" aria-hidden />}
              Bulk select
            </button>
          </div>

          {/* Property count */}
          <div
            className={cn(
              'absolute top-4 right-16 z-10 inline-flex items-center rounded-md',
              'border border-border bg-surface/90 px-3 py-1 text-xs text-fg-muted backdrop-blur-sm'
            )}
          >
            <span className="font-tabular text-fg">
              {pins.length.toLocaleString()}
            </span>
            <span className="ml-1">properties</span>
          </div>

          <BulkSelectMenu
            selectedCount={selectedIds.size}
            onAddToPortfolio={() => setPortfolioModalOpen(true)}
            onExportCsv={handleExportCsv}
            onReassignClient={() => {}}
            onClear={() => { setSelectedIds(new Set()); setBulkSelectMode(false) }}
          />
        </div>

        <PropertyDetailPanel
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          property={selectedProperty}
          locations={selectedProperty?.service_locations ?? []}
        />
      </div>

      {/* Create Portfolio dialog. Migrated off the legacy <Modal> to the
          design Dialog so focus trap + Esc-close come for free. */}
      <Dialog open={portfolioModalOpen} onOpenChange={setPortfolioModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create portfolio</DialogTitle>
            <DialogDescription>
              Bundle the {selectedIds.size} selected{' '}
              {selectedIds.size === 1 ? 'property' : 'properties'} into a named
              portfolio you can revisit later.
            </DialogDescription>
          </DialogHeader>
          <FormField label="Name" htmlFor="portfolio-name">
            <Input
              id="portfolio-name"
              type="text"
              placeholder="e.g. North Texas Q3"
              value={portfolioName}
              onChange={(e) => setPortfolioName(e.target.value)}
              autoFocus
            />
          </FormField>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button
              size="sm"
              onClick={handleCreatePortfolio}
              loading={savingPortfolio}
              disabled={!portfolioName.trim()}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
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
