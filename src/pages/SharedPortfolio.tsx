import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import type { Portfolio, PropertyWithLocations } from '../types'
import PortfolioStats from '../components/portfolio/PortfolioStats'

export default function SharedPortfolioPage() {
  const { shareToken } = useParams<{ shareToken: string }>()
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [properties, setProperties] = useState<PropertyWithLocations[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      if (!shareToken) return
      setLoading(true)
      try {
        const res = await fetch(`/api/v1/shared-portfolios/${shareToken}`)
        if (!res.ok) {
          setError(res.status === 404 ? 'This portfolio link is invalid or has expired.' : 'Failed to load portfolio.')
          return
        }
        const data = await res.json()
        setPortfolio(data.portfolio)
        setProperties(data.properties ?? [])
      } catch {
        setError('Failed to load portfolio.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [shareToken])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading portfolio...</div>
      </div>
    )
  }

  if (error || !portfolio) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">🗺️</div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">Portfolio Not Found</h1>
          <p className="text-gray-500">{error ?? 'This link is invalid.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-blue-700 font-bold text-lg mb-1">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
              </svg>
              PortfolioIQ
            </div>
            <h1 className="text-xl font-bold text-gray-900">{portfolio.name}</h1>
            {portfolio.description && <p className="text-gray-500 text-sm">{portfolio.description}</p>}
          </div>
          <div className="text-sm text-gray-400">Read-only shared view</div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <PortfolioStats properties={properties} />

        <div className="bg-white rounded-xl border shadow-sm">
          <div className="px-6 py-4 border-b">
            <h2 className="font-semibold text-gray-800">
              Service Locations ({properties.reduce((s, p) => s + p.service_locations.length, 0)})
            </h2>
          </div>
          <div className="divide-y">
            {properties.flatMap((p) =>
              p.service_locations.map((loc) => (
                <div key={loc.service_location_id} className="px-6 py-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">
                      {loc.display_name ?? loc.location_code ?? 'Location'}
                    </p>
                    <p className="text-sm text-gray-500">
                      {p.address_line1}, {p.city}, {p.state} {p.postal_code}
                    </p>
                  </div>
                  <div className="text-right text-sm text-gray-500">
                    {p.rbm_category && (
                      <span className="text-gray-600 capitalize">{p.rbm_category.replace(/_/g, ' ')}</span>
                    )}
                    {loc.serviceable_sqft && (
                      <p>{loc.serviceable_sqft.toLocaleString()} sqft</p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
