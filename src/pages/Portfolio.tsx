import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import AppShell from '../components/layout/AppShell'
import Button from '../components/ui/Button'
import PortfolioStats from '../components/portfolio/PortfolioStats'
import ShareLinkModal from '../components/portfolio/ShareLinkModal'
import type { Portfolio, PropertyWithLocations } from '../types'

export default function PortfolioPage() {
  const { portfolioId } = useParams<{ portfolioId: string }>()
  const navigate = useNavigate()
  const { getToken } = useAuth()

  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [properties, setProperties] = useState<PropertyWithLocations[]>([])
  const [loading, setLoading] = useState(true)
  const [shareModalOpen, setShareModalOpen] = useState(false)

  useEffect(() => {
    async function load() {
      if (!portfolioId) return
      setLoading(true)
      try {
        const token = await getToken()
        const headers = { Authorization: `Bearer ${token}` }
        const [portRes, locsRes] = await Promise.all([
          fetch(`/api/v1/portfolios/${portfolioId}`, { headers }),
          fetch(`/api/v1/portfolios/${portfolioId}/locations`, { headers }),
        ])
        if (portRes.ok) setPortfolio(await portRes.json())
        if (locsRes.ok) {
          const data = await locsRes.json()
          setProperties(data.properties ?? [])
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [portfolioId, getToken])

  if (loading) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center text-fg-subtle">Loading…</div>
      </AppShell>
    )
  }

  if (!portfolio) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center text-fg-subtle">Portfolio not found.</div>
      </AppShell>
    )
  }

  return (
    <AppShell breadcrumb={[{ label: 'Portfolios' }, { label: portfolio.name }]}>
      <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{portfolio.name}</h1>
              {portfolio.description && (
                <p className="text-gray-500 mt-1">{portfolio.description}</p>
              )}
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" size="sm" onClick={() => setShareModalOpen(true)}>
                Share
              </Button>
              <Button variant="secondary" size="sm" onClick={() => navigate('/map')}>
                View on Map
              </Button>
            </div>
          </div>

          <PortfolioStats properties={properties} />

          {/* Location list */}
          <div className="bg-white rounded-xl border shadow-sm">
            <div className="px-6 py-4 border-b">
              <h2 className="font-semibold text-gray-800">
                Service Locations ({properties.reduce((s, p) => s + p.service_locations.length, 0)})
              </h2>
            </div>
            <div className="divide-y">
              {properties.flatMap((p) =>
                p.service_locations.map((loc) => (
                  <div
                    key={loc.service_location_id}
                    className="px-6 py-4 hover:bg-gray-50 cursor-pointer flex items-center justify-between"
                    onClick={() => navigate(`/locations/${loc.service_location_id}`)}
                  >
                    <div>
                      <p className="font-medium text-gray-900">
                        {loc.display_name ?? loc.location_code ?? loc.service_location_id.slice(0, 8)}
                      </p>
                      <p className="text-sm text-gray-500">
                        {p.address_line1}, {p.city}, {p.state}
                      </p>
                    </div>
                    <div className="text-right text-sm text-gray-500">
                      {loc.serviceable_sqft?.toLocaleString()} sqft
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
      </div>

      <ShareLinkModal
        open={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        portfolioId={portfolioId!}
        existingToken={portfolio.share_token}
      />
    </AppShell>
  )
}
