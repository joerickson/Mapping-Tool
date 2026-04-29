import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import Navbar from '../components/ui/Navbar'
import Button from '../components/ui/Button'
import type { ServiceLocation } from '../types'
import { CATEGORY_COLORS, STATUS_LABELS, STATUS_COLORS } from '../lib/constants'

// Extends Property with DB fields that aren't in the base type + joined tables
interface PropertyDetail {
  property_id: string
  address_line1: string
  address_line2?: string | null
  city: string
  state: string
  postal_code: string
  latitude?: number | null
  longitude?: number | null
  geocode_source?: string | null
  geocode_confidence?: string | null
  geocoded_at?: string | null
  google_place_id?: string | null
  place_name?: string | null
  place_website?: string | null
  place_phone?: string | null
  building_sqft?: number | null
  lot_sqft?: number | null
  year_built?: number | null
  zoning_code?: string | null
  land_use_code?: string | null
  owner_name?: string | null
  parcel_id?: string | null
  rbm_category?: string | null
  rbm_subcategory?: string | null
  rbm_category_confidence?: number | null
  rbm_category_source?: string | null
  enrichment_status: string
  enrichment_errors?: Record<string, unknown> | null
  last_enriched_at?: string | null
  created_at: string
  updated_at: string
  // Validation fields stored in DB (not in base Property type)
  validated_address_line1?: string | null
  validated_city?: string | null
  validated_state?: string | null
  validated_postal_code?: string | null
  address_validation_verdict?: string | null
  address_validated_at?: string | null
  // Risk assessment
  risk_flags?: Array<{ type: string; severity: 'low' | 'medium' | 'high'; description: string }> | null
  risk_score?: number | null
  risk_assessed_at?: string | null
  // Joined tables
  service_locations: ServiceLocation[]
  enrichment_jobs: Array<{
    enrichment_job_id: string
    status: string
    completed_at: string | null
    created_at: string
  }>
}

export default function PropertyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { getToken } = useAuth()

  const [property, setProperty] = useState<PropertyDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [streetViewAvailable, setStreetViewAvailable] = useState<boolean | null>(null)
  const [enriching, setEnriching] = useState(false)
  const [enrichMsg, setEnrichMsg] = useState<string | null>(null)
  const [reassessing, setReassessing] = useState(false)

  useEffect(() => {
    async function load() {
      if (!id) return
      setLoading(true)
      try {
        const token = await getToken()
        const res = await fetch(`/api/v1/properties/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) {
          const data = await res.json()
          setProperty(data)
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id, getToken])

  // Check Street View availability
  useEffect(() => {
    if (!property?.latitude || !property?.longitude) {
      setStreetViewAvailable(false)
      return
    }
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
    if (!key) {
      setStreetViewAvailable(false)
      return
    }
    const params = new URLSearchParams({
      location: `${property.latitude},${property.longitude}`,
      key,
    })
    fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?${params}`)
      .then((r) => r.json())
      .then((d) => setStreetViewAvailable(d.status === 'OK'))
      .catch(() => setStreetViewAvailable(false))
  }, [property?.latitude, property?.longitude])

  const handleEnrich = async () => {
    if (!property) return
    setEnriching(true)
    setEnrichMsg(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/properties/${property.property_id}/enrich`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        setEnrichMsg('Enrichment completed successfully.')
        const reloadRes = await fetch(`/api/v1/properties/${property.property_id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (reloadRes.ok) setProperty(await reloadRes.json())
      } else {
        setEnrichMsg('Enrichment failed. Check server logs.')
      }
    } finally {
      setEnriching(false)
    }
  }

  const handleReassessRisk = async () => {
    if (!property) return
    setReassessing(true)
    try {
      const token = await getToken()
      const res = await fetch(`/api/analyses/properties/${property.property_id}/risk-flags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      })
      if (res.ok) {
        const result = await res.json()
        setProperty((prev) =>
          prev
            ? {
                ...prev,
                risk_flags: result.risk_flags,
                risk_score: result.risk_score,
                risk_assessed_at: result.risk_assessed_at,
              }
            : prev
        )
      }
    } finally {
      setReassessing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col h-screen">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-500">Loading...</div>
        </div>
      </div>
    )
  }

  if (!property) {
    return (
      <div className="flex flex-col h-screen">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-500">Property not found.</div>
        </div>
      </div>
    )
  }

  const hasValidatedAddress = !!(
    property.validated_address_line1 &&
    property.validated_address_line1 !== property.address_line1
  )

  const googleMapsKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
  const mapboxToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN

  const streetViewUrl =
    streetViewAvailable && googleMapsKey && property.latitude && property.longitude
      ? (() => {
          const params = new URLSearchParams({
            size: '600x400',
            location: `${property.latitude},${property.longitude}`,
            fov: '90',
            pitch: '0',
            key: googleMapsKey,
          })
          return `https://maps.googleapis.com/maps/api/streetview?${params}`
        })()
      : null

  const googleMapsStreetViewUrl =
    property.latitude && property.longitude
      ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${property.latitude},${property.longitude}`
      : null

  const googleMapsRegularUrl =
    property.latitude && property.longitude
      ? `https://www.google.com/maps/search/?api=1&query=${property.latitude},${property.longitude}`
      : null

  const miniMapUrl =
    property.latitude && property.longitude && mapboxToken
      ? `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/pin-s+3b82f6(${property.longitude},${property.latitude})/${property.longitude},${property.latitude},15,0/600x300@2x?access_token=${mapboxToken}`
      : null

  const categoryColor = property.rbm_category
    ? (CATEGORY_COLORS[property.rbm_category] ?? CATEGORY_COLORS.default)
    : null

  const hasParcelData = !!(
    property.building_sqft ||
    property.lot_sqft ||
    property.year_built ||
    property.owner_name ||
    property.parcel_id
  )

  const hasCoords = !!(property.latitude && property.longitude)

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <Navbar />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">

          {/* Header */}
          <div>
            <button
              onClick={() => navigate('/map')}
              className="text-sm text-blue-600 hover:underline mb-2 flex items-center gap-1"
            >
              ← Back to Map
            </button>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{property.address_line1}</h1>
                {property.address_line2 && (
                  <p className="text-gray-600">{property.address_line2}</p>
                )}
                <p className="text-gray-600">
                  {property.city}, {property.state} {property.postal_code}
                </p>
                {hasValidatedAddress && (
                  <p className="text-sm text-gray-400 mt-1">
                    Validated: {property.validated_address_line1}, {property.validated_city},{' '}
                    {property.validated_state} {property.validated_postal_code}
                    {property.address_validation_verdict && (
                      <span className="ml-1 text-gray-300">({property.address_validation_verdict})</span>
                    )}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                {property.rbm_category && categoryColor && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: categoryColor }} />
                    <span className="text-sm text-gray-700 capitalize">
                      {property.rbm_category.replace(/_/g, ' ')}
                    </span>
                  </div>
                )}
                <span
                  className={`px-2 py-1 rounded text-xs font-medium ${
                    property.enrichment_status === 'enriched'
                      ? 'bg-green-100 text-green-700'
                      : property.enrichment_status === 'failed'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-yellow-100 text-yellow-700'
                  }`}
                >
                  {property.enrichment_status}
                </span>
              </div>
            </div>
          </div>

          {/* Street View */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Street View</h2>
            {streetViewAvailable === null && (
              <div className="text-sm text-gray-400">Checking street view availability...</div>
            )}
            {streetViewAvailable === false && (
              <div className="text-sm text-gray-500">
                {hasCoords
                  ? 'Street view not available for this location.'
                  : 'Street View unavailable — no coordinates.'}
              </div>
            )}
            {streetViewAvailable && streetViewUrl && (
              <div className="rounded-lg overflow-hidden border border-gray-200">
                <img
                  src={streetViewUrl}
                  alt={`Street view of ${property.address_line1}`}
                  className="w-full h-auto"
                />
              </div>
            )}
            {hasCoords && (
              <div className="flex gap-4 mt-3">
                {googleMapsStreetViewUrl && (
                  <a
                    href={googleMapsStreetViewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline"
                  >
                    Open in Street View ↗
                  </a>
                )}
                {googleMapsRegularUrl && (
                  <a
                    href={googleMapsRegularUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline"
                  >
                    View on Google Maps ↗
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Mini Map */}
          {miniMapUrl && (
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Location</h2>
              <div className="rounded-lg overflow-hidden border border-gray-200">
                <img src={miniMapUrl} alt="Property location map" className="w-full h-auto" />
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {property.latitude?.toFixed(6)}, {property.longitude?.toFixed(6)}
                {property.geocode_confidence && ` · confidence: ${property.geocode_confidence}`}
              </p>
            </div>
          )}

          {/* Service Locations */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Service Locations ({property.service_locations.length})
            </h2>
            {property.service_locations.length === 0 ? (
              <p className="text-sm text-gray-500">No service locations linked to this property.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 pr-4 text-xs font-medium text-gray-500 uppercase tracking-wide">Name</th>
                      <th className="text-left py-2 pr-4 text-xs font-medium text-gray-500 uppercase tracking-wide">Suite / Floor</th>
                      <th className="text-left py-2 pr-4 text-xs font-medium text-gray-500 uppercase tracking-wide">Sqft</th>
                      <th className="text-left py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {property.service_locations.map((loc) => (
                      <tr
                        key={loc.service_location_id}
                        className="border-b last:border-0 hover:bg-gray-50 cursor-pointer"
                        onClick={() => navigate(`/locations/${loc.service_location_id}`)}
                      >
                        <td className="py-2.5 pr-4 font-medium text-gray-900">
                          {loc.display_name ?? loc.location_code ?? loc.service_location_id.slice(0, 8)}
                        </td>
                        <td className="py-2.5 pr-4 text-gray-500">{loc.suite_or_floor ?? '—'}</td>
                        <td className="py-2.5 pr-4 text-gray-600">
                          {loc.serviceable_sqft ? loc.serviceable_sqft.toLocaleString() : '—'}
                        </td>
                        <td className="py-2.5">
                          <span
                            className="px-2 py-0.5 rounded-full text-white text-xs font-medium"
                            style={{ backgroundColor: STATUS_COLORS[loc.status] }}
                          >
                            {STATUS_LABELS[loc.status]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Parcel Data */}
          {hasParcelData && (
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Parcel Data</h2>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                {property.building_sqft && (
                  <>
                    <dt className="text-gray-500">Building Sqft</dt>
                    <dd className="text-gray-900">{property.building_sqft.toLocaleString()}</dd>
                  </>
                )}
                {property.lot_sqft && (
                  <>
                    <dt className="text-gray-500">Lot Sqft</dt>
                    <dd className="text-gray-900">{property.lot_sqft.toLocaleString()}</dd>
                  </>
                )}
                {property.year_built && (
                  <>
                    <dt className="text-gray-500">Year Built</dt>
                    <dd className="text-gray-900">{property.year_built}</dd>
                  </>
                )}
                {property.owner_name && (
                  <>
                    <dt className="text-gray-500">Owner</dt>
                    <dd className="text-gray-900">{property.owner_name}</dd>
                  </>
                )}
                {property.zoning_code && (
                  <>
                    <dt className="text-gray-500">Zoning</dt>
                    <dd className="text-gray-900">{property.zoning_code}</dd>
                  </>
                )}
                {property.land_use_code && (
                  <>
                    <dt className="text-gray-500">Land Use</dt>
                    <dd className="text-gray-900">{property.land_use_code}</dd>
                  </>
                )}
                {property.parcel_id && (
                  <>
                    <dt className="text-gray-500">Parcel ID</dt>
                    <dd className="text-gray-900 font-mono text-xs">{property.parcel_id}</dd>
                  </>
                )}
              </dl>
            </div>
          )}

          {/* RBM Category */}
          {(property.rbm_category || property.place_name) && (
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Business &amp; Classification</h2>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                {property.place_name && (
                  <>
                    <dt className="text-gray-500">Place Name</dt>
                    <dd className="text-gray-900">{property.place_name}</dd>
                  </>
                )}
                {property.place_phone && (
                  <>
                    <dt className="text-gray-500">Phone</dt>
                    <dd className="text-gray-900">{property.place_phone}</dd>
                  </>
                )}
                {property.place_website && (
                  <>
                    <dt className="text-gray-500">Website</dt>
                    <dd>
                      <a
                        href={property.place_website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline text-sm"
                      >
                        {property.place_website}
                      </a>
                    </dd>
                  </>
                )}
                {property.rbm_category && (
                  <>
                    <dt className="text-gray-500">RBM Category</dt>
                    <dd className="text-gray-900 capitalize">{property.rbm_category.replace(/_/g, ' ')}</dd>
                  </>
                )}
                {property.rbm_subcategory && (
                  <>
                    <dt className="text-gray-500">Subcategory</dt>
                    <dd className="text-gray-900 capitalize">{property.rbm_subcategory.replace(/_/g, ' ')}</dd>
                  </>
                )}
                {property.rbm_category_confidence != null && (
                  <>
                    <dt className="text-gray-500">Confidence</dt>
                    <dd className="text-gray-900">
                      {Math.round(property.rbm_category_confidence * 100)}%
                      {property.rbm_category_source && (
                        <span className="text-gray-400 ml-1">({property.rbm_category_source})</span>
                      )}
                    </dd>
                  </>
                )}
              </dl>
            </div>
          )}

          {/* Risk Assessment */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Risk Assessment</h2>
                {property.risk_assessed_at && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    Last assessed: {new Date(property.risk_assessed_at).toLocaleString()}
                  </p>
                )}
              </div>
              <Button size="sm" variant="secondary" onClick={handleReassessRisk} loading={reassessing}>
                {property.risk_assessed_at ? 'Re-assess' : 'Assess'}
              </Button>
            </div>

            {!property.risk_assessed_at ? (
              <p className="text-sm text-gray-500">
                No risk assessment yet. Click "Assess" to compute risk flags for this property.
              </p>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Risk score</p>
                    <p className="text-2xl font-bold text-gray-900">{property.risk_score ?? 0}</p>
                  </div>
                  <div>
                    <span
                      className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                        (property.risk_score ?? 0) >= 6
                          ? 'bg-red-100 text-red-700'
                          : (property.risk_score ?? 0) >= 3
                          ? 'bg-orange-100 text-orange-700'
                          : (property.risk_score ?? 0) >= 1
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-green-100 text-green-700'
                      }`}
                    >
                      {(property.risk_score ?? 0) >= 6
                        ? 'High risk'
                        : (property.risk_score ?? 0) >= 3
                        ? 'Elevated'
                        : (property.risk_score ?? 0) >= 1
                        ? 'Mild'
                        : 'No risk'}
                    </span>
                  </div>
                </div>

                {(property.risk_flags ?? []).length === 0 ? (
                  <p className="text-sm text-gray-500">No risk flags detected.</p>
                ) : (
                  <ul className="space-y-2">
                    {(property.risk_flags ?? []).map((f, i) => (
                      <li
                        key={i}
                        className={`border-l-4 px-3 py-2 text-sm ${
                          f.severity === 'high'
                            ? 'border-red-400 bg-red-50'
                            : f.severity === 'medium'
                            ? 'border-orange-400 bg-orange-50'
                            : 'border-yellow-400 bg-yellow-50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">
                            {f.type.replace(/_/g, ' ')}
                          </span>
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded ${
                              f.severity === 'high'
                                ? 'bg-red-100 text-red-700'
                                : f.severity === 'medium'
                                ? 'bg-orange-100 text-orange-700'
                                : 'bg-yellow-100 text-yellow-700'
                            }`}
                          >
                            {f.severity}
                          </span>
                        </div>
                        <p className="text-gray-600 text-xs mt-0.5">{f.description}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          {/* Enrichment Metadata */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Enrichment</h2>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm mb-4">
              <dt className="text-gray-500">Status</dt>
              <dd>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    property.enrichment_status === 'enriched'
                      ? 'bg-green-100 text-green-700'
                      : property.enrichment_status === 'failed'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-yellow-100 text-yellow-700'
                  }`}
                >
                  {property.enrichment_status}
                </span>
              </dd>
              {property.geocoded_at && (
                <>
                  <dt className="text-gray-500">Geocoded</dt>
                  <dd className="text-gray-900">{new Date(property.geocoded_at).toLocaleDateString()}</dd>
                </>
              )}
              {property.geocode_confidence && (
                <>
                  <dt className="text-gray-500">Geocode Confidence</dt>
                  <dd className="text-gray-900">{property.geocode_confidence}</dd>
                </>
              )}
              {property.address_validated_at && (
                <>
                  <dt className="text-gray-500">Address Validated</dt>
                  <dd className="text-gray-900">
                    {new Date(property.address_validated_at).toLocaleDateString()}
                  </dd>
                </>
              )}
              {property.address_validation_verdict && (
                <>
                  <dt className="text-gray-500">Validation Verdict</dt>
                  <dd className="text-gray-900">{property.address_validation_verdict}</dd>
                </>
              )}
              {property.last_enriched_at && (
                <>
                  <dt className="text-gray-500">Last Enriched</dt>
                  <dd className="text-gray-900">
                    {new Date(property.last_enriched_at).toLocaleDateString()}
                  </dd>
                </>
              )}
            </dl>

            {enrichMsg && (
              <p
                className={`text-sm mb-3 ${
                  enrichMsg.includes('failed') ? 'text-red-600' : 'text-green-600'
                }`}
              >
                {enrichMsg}
              </p>
            )}

            <Button size="sm" variant="secondary" onClick={handleEnrich} loading={enriching}>
              Re-enrich this property
            </Button>
          </div>

        </div>
      </div>
    </div>
  )
}
