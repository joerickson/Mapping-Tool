import { useNavigate } from 'react-router-dom'
import SlideOver from '../ui/SlideOver'
import type { Property, ServiceLocation } from '../../types'
import { CATEGORY_COLORS, STATUS_LABELS, STATUS_COLORS } from '../../lib/constants'

interface PropertyDetailPanelProps {
  open: boolean
  onClose: () => void
  property: Property | null
  locations: ServiceLocation[]
}

export default function PropertyDetailPanel({
  open,
  onClose,
  property,
  locations,
}: PropertyDetailPanelProps) {
  const navigate = useNavigate()

  if (!property) return null

  const categoryColor = CATEGORY_COLORS[property.rbm_category ?? 'default'] ?? CATEGORY_COLORS.default

  return (
    <SlideOver open={open} onClose={onClose} title="Property Details" side="right">
      <div className="space-y-5">
        {/* Category badge */}
        {property.rbm_category && (
          <div className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: categoryColor }}
            />
            <span className="text-sm font-medium text-gray-700 capitalize">
              {property.rbm_category.replace(/_/g, ' ')}
            </span>
            {property.rbm_category_confidence != null && (
              <span className="text-xs text-gray-400">
                ({Math.round(property.rbm_category_confidence * 100)}% confidence)
              </span>
            )}
          </div>
        )}

        {/* Address */}
        <div>
          <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1">Address</p>
          <p className="text-gray-900 font-medium">{property.address_line1}</p>
          {property.address_line2 && <p className="text-gray-600">{property.address_line2}</p>}
          <p className="text-gray-600">
            {property.city}, {property.state} {property.postal_code}
          </p>
        </div>

        {/* Business info */}
        {property.place_name && (
          <div>
            <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1">Business</p>
            <p className="text-gray-900">{property.place_name}</p>
            {property.place_phone && (
              <p className="text-gray-600 text-sm">{property.place_phone}</p>
            )}
            {property.place_website && (
              <a
                href={property.place_website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 text-sm hover:underline"
              >
                {property.place_website}
              </a>
            )}
          </div>
        )}

        {/* Building info */}
        {(property.building_sqft || property.year_built || property.zoning_code) && (
          <div>
            <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1">Building</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {property.building_sqft && (
                <>
                  <dt className="text-gray-500">Building sqft</dt>
                  <dd className="text-gray-900">{property.building_sqft.toLocaleString()}</dd>
                </>
              )}
              {property.year_built && (
                <>
                  <dt className="text-gray-500">Year built</dt>
                  <dd className="text-gray-900">{property.year_built}</dd>
                </>
              )}
              {property.zoning_code && (
                <>
                  <dt className="text-gray-500">Zoning</dt>
                  <dd className="text-gray-900">{property.zoning_code}</dd>
                </>
              )}
              {property.owner_name && (
                <>
                  <dt className="text-gray-500">Owner</dt>
                  <dd className="text-gray-900 truncate">{property.owner_name}</dd>
                </>
              )}
            </dl>
          </div>
        )}

        {/* Enrichment status */}
        <div>
          <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1">Enrichment</p>
          <span
            className={`inline-flex px-2 py-0.5 rounded text-xs font-medium
              ${property.enrichment_status === 'enriched' ? 'bg-green-100 text-green-700' :
                property.enrichment_status === 'failed' ? 'bg-red-100 text-red-700' :
                'bg-yellow-100 text-yellow-700'}`}
          >
            {property.enrichment_status}
          </span>
          {property.last_enriched_at && (
            <p className="text-xs text-gray-400 mt-1">
              Last enriched: {new Date(property.last_enriched_at).toLocaleDateString()}
            </p>
          )}
        </div>

        {/* Service locations */}
        <div>
          <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Service Locations ({locations.length})
          </p>
          <div className="space-y-2">
            {locations.map((loc) => (
              <div
                key={loc.service_location_id}
                className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50 cursor-pointer"
                onClick={() => navigate(`/locations/${loc.service_location_id}`)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {loc.display_name ?? loc.location_code ?? loc.service_location_id.slice(0, 8)}
                    </p>
                    {loc.suite_or_floor && (
                      <p className="text-xs text-gray-500">{loc.suite_or_floor}</p>
                    )}
                    {loc.serviceable_sqft && (
                      <p className="text-xs text-gray-500">{loc.serviceable_sqft.toLocaleString()} sqft</p>
                    )}
                  </div>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full text-white font-medium"
                    style={{ backgroundColor: STATUS_COLORS[loc.status] }}
                  >
                    {STATUS_LABELS[loc.status]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={() => navigate(`/properties/${property.property_id}`)}
          className="w-full mt-2 py-2 px-4 border border-blue-600 text-blue-600 rounded-lg text-sm font-medium hover:bg-blue-50"
        >
          View Full Details →
        </button>
      </div>
    </SlideOver>
  )
}
