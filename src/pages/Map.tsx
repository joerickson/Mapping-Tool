import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useClient } from '../context/ClientContext'
import Navbar from '../components/ui/Navbar'
import MapView from '../components/map/MapView'
import FilterSidebar from '../components/map/FilterSidebar'
import PropertyDetailPanel from '../components/map/PropertyDetailPanel'
import BulkSelectMenu from '../components/map/BulkSelectMenu'
import Modal from '../components/ui/Modal'
import Button from '../components/ui/Button'
import type { Property, ServiceLocation, MapFilter, PropertyWithLocations } from '../types'

const DEFAULT_FILTER: MapFilter = {
  clients: [],
  categories: [],
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
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null)
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
    async function load() {
      setLoading(true)
      try {
        const token = await getToken()
        const params = new URLSearchParams()

        // Apply nav-level client switcher as a filter baseline
        const effectiveClients = filter.clients.length
          ? filter.clients
          : selectedClientId
          ? [selectedClientId]
          : []

        if (effectiveClients.length) params.set('client_id', effectiveClients.join(','))
        if (filter.categories.length) params.set('category', filter.categories.join(','))
        if (filter.statuses.length) params.set('status', filter.statuses.join(','))
        if (filter.portfolios.length) params.set('portfolio_id', filter.portfolios.join(','))
        if (filter.cityState) params.set('city_state', filter.cityState)
        params.set('limit', '2000')

        const res = await fetch(`/api/v1/properties?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) {
          const data = await res.json()
          setPropertiesWithLocations(data.properties ?? [])
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [filter, getToken, selectedClientId])

  const pins = useMemo(
    () =>
      propertiesWithLocations.map((p) => ({
        property: p as Property,
        locations: p.service_locations,
        clientColor: p.service_locations[0]?.client_id
          ? (clientColorMap[p.service_locations[0].client_id] ?? null)
          : null,
      })),
    [propertiesWithLocations, clientColorMap]
  )

  const selectedProperty = useMemo(
    () => propertiesWithLocations.find((p) => p.property_id === selectedPropertyId) ?? null,
    [propertiesWithLocations, selectedPropertyId]
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
        setSelectedPropertyId(pin.property.property_id)
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
    <div className="flex flex-col h-screen bg-gray-100">
      <Navbar />
      <div className="flex flex-1 overflow-hidden relative">
        <FilterSidebar filter={filter} onChange={setFilter} />

        <div className="flex-1 relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/60 z-20">
              <div className="flex items-center gap-2 text-gray-600">
                <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Loading properties...
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
              className={`px-3 py-1.5 rounded-lg text-sm font-medium shadow transition-colors
                ${bulkSelectMode
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                }`}
            >
              {bulkSelectMode ? '✓ Bulk Select' : 'Bulk Select'}
            </button>
          </div>

          {/* Property count */}
          <div className="absolute top-4 right-16 z-10 bg-white/90 rounded-lg px-3 py-1.5 text-sm text-gray-600 shadow">
            {pins.length.toLocaleString()} properties
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

      <Modal
        open={portfolioModalOpen}
        onClose={() => setPortfolioModalOpen(false)}
        title="Create Portfolio"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Create a portfolio with the {selectedIds.size} selected properties.
          </p>
          <input
            type="text"
            placeholder="Portfolio name"
            value={portfolioName}
            onChange={(e) => setPortfolioName(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex justify-end gap-3">
            <Button variant="secondary" size="sm" onClick={() => setPortfolioModalOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleCreatePortfolio} loading={savingPortfolio} disabled={!portfolioName.trim()}>
              Create
            </Button>
          </div>
        </div>
      </Modal>
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
