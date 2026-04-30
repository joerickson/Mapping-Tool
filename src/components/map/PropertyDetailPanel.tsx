import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import SlideOver from '../ui/SlideOver'
import Button from '../ui/Button'
import { Badge } from '../ui/Badge'
import { cn } from '../../lib/cn'
import type { Property, ServiceLocation } from '../../types'
import { CATEGORY_COLORS, STATUS_LABELS } from '../../lib/constants'

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

  const categoryColor =
    CATEGORY_COLORS[property.rbm_category ?? 'default'] ?? CATEGORY_COLORS.default

  return (
    <SlideOver open={open} onClose={onClose} title="Property details" side="right">
      <div className="space-y-6">
        {/* Category badge — colored swatch + label since the color comes from
            an external palette (CATEGORY_COLORS). The Badge component is
            type-fixed so we keep this inline. */}
        {property.rbm_category && (
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-border"
              style={{ backgroundColor: categoryColor }}
            />
            <span className="text-sm font-medium capitalize text-fg">
              {property.rbm_category.replace(/_/g, ' ')}
            </span>
            {property.rbm_category_confidence != null && (
              <span className="text-xs text-fg-subtle">
                ({Math.round(property.rbm_category_confidence * 100)}% confidence)
              </span>
            )}
          </div>
        )}

        {/* Address */}
        <Section label="Address">
          <p className="text-sm font-medium text-fg">{property.address_line1}</p>
          {property.address_line2 && (
            <p className="text-sm text-fg-muted">{property.address_line2}</p>
          )}
          <p className="text-sm text-fg-muted">
            {property.city}, {property.state} {property.postal_code}
          </p>
        </Section>

        {/* Business info */}
        {property.place_name && (
          <Section label="Business">
            <p className="text-sm text-fg">{property.place_name}</p>
            {property.place_phone && (
              <p className="text-sm text-fg-muted font-tabular">
                {property.place_phone}
              </p>
            )}
            {property.place_website && (
              <a
                href={property.place_website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
              >
                {property.place_website}
              </a>
            )}
          </Section>
        )}

        {/* Building info */}
        {(property.building_sqft || property.year_built || property.zoning_code) && (
          <Section label="Building">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              {property.building_sqft && (
                <DefRow term="Building sqft">
                  <span className="font-tabular">
                    {property.building_sqft.toLocaleString()}
                  </span>
                </DefRow>
              )}
              {property.year_built && (
                <DefRow term="Year built">
                  <span className="font-tabular">{property.year_built}</span>
                </DefRow>
              )}
              {property.zoning_code && (
                <DefRow term="Zoning">{property.zoning_code}</DefRow>
              )}
              {property.owner_name && (
                <DefRow term="Owner">
                  <span className="truncate">{property.owner_name}</span>
                </DefRow>
              )}
            </dl>
          </Section>
        )}

        {/* Enrichment status */}
        <Section label="Enrichment">
          <Badge variant={enrichmentVariant(property.enrichment_status)}>
            {property.enrichment_status}
          </Badge>
          {property.last_enriched_at && (
            <p className="text-xs text-fg-subtle mt-1.5">
              Last enriched{' '}
              <span className="font-tabular">
                {new Date(property.last_enriched_at).toLocaleDateString()}
              </span>
            </p>
          )}
        </Section>

        {/* Service locations */}
        <Section label={`Service locations (${locations.length})`}>
          <ul className="space-y-2">
            {locations.map((loc) => (
              <li key={loc.service_location_id}>
                <button
                  type="button"
                  onClick={() => navigate(`/locations/${loc.service_location_id}`)}
                  className={cn(
                    'group block w-full rounded-md border border-border bg-surface px-3 py-2.5 text-left',
                    'transition-colors duration-150 hover:bg-surface-muted hover:border-border-strong',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-medium text-fg truncate">
                        {loc.display_name ??
                          loc.location_code ??
                          loc.service_location_id.slice(0, 8)}
                      </p>
                      {loc.suite_or_floor && (
                        <p className="text-xs text-fg-muted">{loc.suite_or_floor}</p>
                      )}
                      {loc.serviceable_sqft != null && (
                        <p className="text-xs text-fg-muted">
                          <span className="font-tabular">
                            {loc.serviceable_sqft.toLocaleString()}
                          </span>{' '}
                          sqft
                        </p>
                      )}
                    </div>
                    <Badge variant={statusBadgeVariant(loc.status)}>
                      {STATUS_LABELS[loc.status]}
                    </Badge>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Section>

        <Button
          variant="secondary"
          className="w-full justify-center"
          onClick={() => navigate(`/properties/${property.property_id}`)}
        >
          View full details
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </SlideOver>
  )
}

function Section({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
        {label}
      </h3>
      {children}
    </section>
  )
}

function DefRow({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-fg-muted">{term}</dt>
      <dd className="text-fg">{children}</dd>
    </>
  )
}

function enrichmentVariant(
  status: Property['enrichment_status']
): 'success' | 'danger' | 'warning' | 'default' {
  if (status === 'enriched') return 'success'
  if (status === 'failed') return 'danger'
  return 'warning'
}

function statusBadgeVariant(
  status: ServiceLocation['status']
): 'success' | 'warning' | 'danger' | 'default' {
  if (status === 'active') return 'success'
  if (status === 'paused') return 'warning'
  if (status === 'terminated') return 'danger'
  return 'default'
}
