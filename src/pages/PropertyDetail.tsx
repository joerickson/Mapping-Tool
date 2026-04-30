import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ChevronDown, ExternalLink, Pencil } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useCountUp } from '../hooks/useCountUp'
import Button from '../components/ui/Button'
import { Badge, type BadgeProps } from '../components/ui/Badge'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { Skeleton } from '../components/ui/Skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/Table'
import AppShell from '../components/layout/AppShell'
import ComparablesPanel from '../components/analysis/ComparablesPanel'
import ServiceMixPanel from '../components/analysis/ServiceMixPanel'
import ConstraintsPanel from '../components/property/ConstraintsPanel'
import EditableField from '../components/property/EditableField'
import AddressEditDialog from '../components/property/AddressEditDialog'
import ServiceLocationEditDialog from '../components/property/ServiceLocationEditDialog'
import CascadeBanner, { type CascadeInfo } from '../components/property/CascadeBanner'
import EditHistoryPanel from '../components/property/EditHistoryPanel'
import { PROPERTY_FIELDS } from '../lib/editable-fields'
import { CATEGORY_COLORS, STATUS_LABELS } from '../lib/constants'
import { cn } from '../lib/cn'
import type { ServiceLocation } from '../types'

const PROPERTY_FIELD_BY_KEY = Object.fromEntries(PROPERTY_FIELDS.map((f) => [f.key, f]))

const SIZE_CLASS_LABEL: Record<'small' | 'standard' | 'large' | 'multi_day', string> = {
  small: 'Small',
  standard: 'Standard',
  large: 'Large',
  multi_day: 'Multi-day',
}

// Extends Property with DB fields that aren't in the base type + joined tables
interface PropertyDetail {
  property_id: string
  account_id?: string | null
  client_id?: string | null
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
  validated_address_line1?: string | null
  validated_city?: string | null
  validated_state?: string | null
  validated_postal_code?: string | null
  address_validation_verdict?: string | null
  address_validated_at?: string | null
  risk_flags?: Array<{
    type: string
    severity: 'low' | 'medium' | 'high'
    description: string
  }> | null
  risk_score?: number | null
  risk_assessed_at?: string | null
  notes?: string | null
  internal_tags?: string[] | null
  service_locations: ServiceLocation[]
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
  const [addressDialogOpen, setAddressDialogOpen] = useState(false)
  const [editingSL, setEditingSL] = useState<ServiceLocation | null>(null)
  const [cascade, setCascade] = useState<CascadeInfo | null>(null)

  // Phase E — risk score tweens 300ms on each re-assessment so the user
  // sees the number move rather than snap.
  const animatedRiskScore = useCountUp(property?.risk_score ?? null)

  const reload = useCallback(async () => {
    if (!id) return
    const token = await getToken()
    const res = await fetch(`/api/v1/properties/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) setProperty(await res.json())
  }, [id, getToken])

  useEffect(() => {
    async function load() {
      if (!id) return
      setLoading(true)
      try {
        await reload()
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id, reload])

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
      const res = await fetch(
        `/api/analyses/properties/${property.property_id}/risk-flags`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({}),
        }
      )
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
      <AppShell>
        <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-5 w-1/3" />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <div className="space-y-6 lg:col-span-3">
              <Skeleton className="h-64" />
              <Skeleton className="h-32" />
            </div>
            <div className="space-y-6 lg:col-span-2">
              <Skeleton className="h-64" />
            </div>
          </div>
        </div>
      </AppShell>
    )
  }

  if (!property) {
    return (
      <AppShell>
        <div className="mx-auto max-w-6xl px-6 py-10">
          <EmptyState
            title="Property not found"
            description="It may have been removed or you may not have access. Return to the map to keep exploring."
            action={
              <Button variant="secondary" asChild>
                <Link to="/map">← Back to map</Link>
              </Button>
            }
          />
        </div>
      </AppShell>
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
    <AppShell
      breadcrumb={[
        { label: 'Map', to: '/map' },
        { label: property.address_line1 },
      ]}
    >
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-10">
        {cascade && property.account_id && property.client_id && (
          <CascadeBanner
            cascade={cascade}
            accountId={property.account_id}
            clientId={property.client_id}
            onDismiss={() => setCascade(null)}
          />
        )}

        {/* Hero */}
        <header className="space-y-3">
          <button
            onClick={() => navigate('/map')}
            className="inline-flex items-center gap-1 text-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
          >
            ← Back to map
          </button>

          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="space-y-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <h1 className="text-2xl font-semibold tracking-tight text-fg">
                  {property.address_line1}
                </h1>
                <button
                  type="button"
                  onClick={() => setAddressDialogOpen(true)}
                  className="text-fg-subtle hover:text-accent transition-colors"
                  aria-label="Edit address"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
              {property.address_line2 && (
                <p className="text-sm text-fg-muted">{property.address_line2}</p>
              )}
              <p className="text-sm text-fg-muted">
                {property.city}, {property.state}{' '}
                <span className="font-tabular">{property.postal_code}</span>
              </p>
              {hasValidatedAddress && (
                <p className="text-xs text-fg-subtle">
                  Validated:{' '}
                  <span className="text-fg-muted">
                    {property.validated_address_line1}, {property.validated_city},{' '}
                    {property.validated_state}{' '}
                    <span className="font-tabular">
                      {property.validated_postal_code}
                    </span>
                  </span>
                  {property.address_validation_verdict && (
                    <span className="ml-1">
                      ({property.address_validation_verdict})
                    </span>
                  )}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              {property.rbm_category && categoryColor && (
                <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
                  <span
                    className="h-2 w-2 rounded-full ring-1 ring-border"
                    style={{ backgroundColor: categoryColor }}
                  />
                  <span className="capitalize">
                    {property.rbm_category.replace(/_/g, ' ')}
                  </span>
                </span>
              )}
              <Badge variant={enrichmentVariant(property.enrichment_status)}>
                {property.enrichment_status}
              </Badge>
              {property.risk_assessed_at && (
                <Badge variant={riskVariant(property.risk_score ?? 0)}>
                  Risk:{' '}
                  <span className="font-tabular">{property.risk_score ?? 0}</span>
                </Badge>
              )}
            </div>
          </div>
        </header>

        {/* Two-column on desktop. 5-col grid → 3/2 split = 60/40. */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* Main column (60%) */}
          <div className="space-y-6 lg:col-span-3">
            {/* Map + Street View — side by side on md+ since each is a tall
                visual block; stacked on mobile. */}
            {(miniMapUrl || streetViewUrl || streetViewAvailable === false) && (
              <Card padding="md">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {/* Mini map */}
                  {miniMapUrl ? (
                    <div className="space-y-2">
                      <SectionLabel>Location</SectionLabel>
                      <div className="overflow-hidden rounded-md border border-border">
                        <img
                          src={miniMapUrl}
                          alt="Property location map"
                          className="h-auto w-full"
                        />
                      </div>
                      {hasCoords && (
                        <p className="text-xs text-fg-subtle font-mono">
                          {property.latitude?.toFixed(6)},{' '}
                          {property.longitude?.toFixed(6)}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-fg-subtle">
                      Map preview unavailable.
                    </div>
                  )}

                  {/* Street View */}
                  <div className="space-y-2">
                    <SectionLabel>Street view</SectionLabel>
                    {streetViewAvailable === null && (
                      <Skeleton className="h-44" />
                    )}
                    {streetViewAvailable === false && (
                      <p className="text-sm text-fg-subtle">
                        {hasCoords
                          ? 'Street view not available for this location.'
                          : 'Street view unavailable — no coordinates.'}
                      </p>
                    )}
                    {streetViewAvailable && streetViewUrl && (
                      <div className="overflow-hidden rounded-md border border-border">
                        <img
                          src={streetViewUrl}
                          alt={`Street view of ${property.address_line1}`}
                          className="h-auto w-full"
                        />
                      </div>
                    )}
                    {hasCoords && (
                      <div className="flex flex-wrap gap-3 pt-1 text-xs">
                        {googleMapsStreetViewUrl && (
                          <ExternalAnchor href={googleMapsStreetViewUrl}>
                            Open in Street View
                          </ExternalAnchor>
                        )}
                        {googleMapsRegularUrl && (
                          <ExternalAnchor href={googleMapsRegularUrl}>
                            View on Google Maps
                          </ExternalAnchor>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            )}

            {/* Service Locations */}
            <Card padding="none">
              <div className="border-b border-border px-6 py-4">
                <CardTitle>
                  Service locations
                  <span className="ml-2 font-mono font-normal tabular-nums text-fg-subtle">
                    ({property.service_locations.length})
                  </span>
                </CardTitle>
              </div>
              {property.service_locations.length === 0 ? (
                <p className="px-6 py-6 text-sm text-fg-muted">
                  No service locations linked to this property.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Suite / floor</TableHead>
                      <TableHead className="text-right">Sqft</TableHead>
                      <TableHead>Size class</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {property.service_locations.map((loc) => (
                      <TableRow
                        key={loc.service_location_id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/locations/${loc.service_location_id}`)}
                      >
                        <TableCell className="font-medium text-fg">
                          {loc.display_name ??
                            loc.location_code ??
                            loc.service_location_id.slice(0, 8)}
                        </TableCell>
                        <TableCell className="text-fg-muted">
                          {loc.suite_or_floor ?? '—'}
                        </TableCell>
                        <TableCell numeric>
                          {loc.serviceable_sqft
                            ? loc.serviceable_sqft.toLocaleString()
                            : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-fg-muted">
                          {loc.building_size_class_override ? (
                            <span title={loc.building_size_override_reason ?? undefined}>
                              {SIZE_CLASS_LABEL[loc.building_size_class_override]}
                              <span className="text-fg-subtle"> · override</span>
                            </span>
                          ) : (
                            <span className="text-fg-subtle">Auto</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusBadgeVariant(loc.status)}>
                            {STATUS_LABELS[loc.status]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditingSL(loc)
                            }}
                            className="text-fg-subtle hover:text-accent transition-colors"
                            aria-label="Edit service location"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>

            {/* Risk Assessment */}
            <Card>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle>Risk assessment</CardTitle>
                  {property.risk_assessed_at && (
                    <CardDescription>
                      Last assessed{' '}
                      <span className="font-tabular">
                        {new Date(property.risk_assessed_at).toLocaleString()}
                      </span>
                    </CardDescription>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleReassessRisk}
                  loading={reassessing}
                >
                  {property.risk_assessed_at ? 'Re-assess' : 'Assess'}
                </Button>
              </div>

              <div className="mt-4">
                {!property.risk_assessed_at ? (
                  <p className="text-sm text-fg-muted">
                    No risk assessment yet. Click{' '}
                    <span className="font-medium text-fg">Assess</span> to compute
                    risk flags.
                  </p>
                ) : (
                  <>
                    <div className="flex items-center gap-4 mb-4">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                          Risk score
                        </p>
                        <p className="font-mono text-3xl font-semibold tabular-nums text-fg leading-none mt-1">
                          {Math.round(animatedRiskScore)}
                        </p>
                      </div>
                      <Badge variant={riskVariant(property.risk_score ?? 0)}>
                        {riskLabel(property.risk_score ?? 0)}
                      </Badge>
                    </div>

                    {(property.risk_flags ?? []).length === 0 ? (
                      <p className="text-sm text-fg-muted">No risk flags detected.</p>
                    ) : (
                      <ul className="space-y-2">
                        {(property.risk_flags ?? []).map((f, i) => (
                          <li
                            key={i}
                            className={cn(
                              'rounded-md border-l-2 bg-surface-subtle px-3 py-2 text-sm',
                              f.severity === 'high' && 'border-danger',
                              f.severity === 'medium' && 'border-warning',
                              f.severity === 'low' && 'border-fg-subtle'
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-fg capitalize">
                                {f.type.replace(/_/g, ' ')}
                              </span>
                              <Badge variant={severityVariant(f.severity)}>
                                {f.severity}
                              </Badge>
                            </div>
                            <p className="mt-0.5 text-xs text-fg-muted">
                              {f.description}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            </Card>

            {/* Service constraints */}
            <ConstraintsPanel serviceLocations={property.service_locations} />

            {/* Comparable Properties */}
            <ComparablesPanel propertyId={property.property_id} />

            {/* Service Mix Recommendation */}
            <ServiceMixPanel propertyId={property.property_id} />

            {/* Edit history (collapsible, default closed) */}
            <EditHistoryPanel propertyId={property.property_id} />
          </div>

          {/* Right metadata sidebar (40%) */}
          <aside className="space-y-6 lg:col-span-2">
            {/* Notes & tags — internal-only field for bid teams */}
            <Card>
              <CardHeader>
                <CardTitle>Notes &amp; tags</CardTitle>
              </CardHeader>
              <div className="mt-4 space-y-5">
                <EditableField
                  spec={PROPERTY_FIELD_BY_KEY.notes}
                  value={property.notes}
                  endpoint={`/api/v1/properties/${property.property_id}`}
                  onSaved={reload}
                />
                <EditableField
                  spec={PROPERTY_FIELD_BY_KEY.internal_tags}
                  value={property.internal_tags ?? []}
                  endpoint={`/api/v1/properties/${property.property_id}`}
                  onSaved={reload}
                />
              </div>
            </Card>

            {/* Business & classification */}
            <Card>
              <CardHeader>
                <CardTitle>Business &amp; classification</CardTitle>
              </CardHeader>
              {(property.place_name || property.place_phone || property.place_website ||
                property.rbm_category_confidence != null) && (
                <DefList className="mt-4">
                  {property.place_name && (
                    <DefRow term="Place name">{property.place_name}</DefRow>
                  )}
                  {property.place_phone && (
                    <DefRow term="Phone">
                      <span className="font-tabular">{property.place_phone}</span>
                    </DefRow>
                  )}
                  {property.place_website && (
                    <DefRow term="Website">
                      <a
                        href={property.place_website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm break-all"
                      >
                        {property.place_website}
                      </a>
                    </DefRow>
                  )}
                  {property.rbm_category_confidence != null && (
                    <DefRow term="Confidence">
                      <span className="font-tabular">
                        {Math.round(property.rbm_category_confidence * 100)}%
                      </span>
                      {property.rbm_category_source && (
                        <span className="ml-1 text-fg-subtle">
                          ({property.rbm_category_source})
                        </span>
                      )}
                    </DefRow>
                  )}
                </DefList>
              )}
              <div className="mt-4 space-y-5 border-t border-border pt-4">
                <EditableField
                  spec={PROPERTY_FIELD_BY_KEY.rbm_category}
                  value={property.rbm_category}
                  endpoint={`/api/v1/properties/${property.property_id}`}
                  onSaved={reload}
                />
                <EditableField
                  spec={PROPERTY_FIELD_BY_KEY.rbm_subcategory}
                  value={property.rbm_subcategory}
                  endpoint={`/api/v1/properties/${property.property_id}`}
                  onSaved={reload}
                />
              </div>
            </Card>

            {/* Parcel data — hidden when nothing populated, per spec */}
            {hasParcelData && (
              <Card>
                <CardHeader>
                  <CardTitle>Parcel data</CardTitle>
                </CardHeader>
                <DefList className="mt-4">
                  {property.building_sqft && (
                    <DefRow term="Building sqft">
                      <span className="font-tabular">
                        {property.building_sqft.toLocaleString()}
                      </span>
                    </DefRow>
                  )}
                  {property.lot_sqft && (
                    <DefRow term="Lot sqft">
                      <span className="font-tabular">
                        {property.lot_sqft.toLocaleString()}
                      </span>
                    </DefRow>
                  )}
                  {property.year_built && (
                    <DefRow term="Year built">
                      <span className="font-tabular">{property.year_built}</span>
                    </DefRow>
                  )}
                  {property.owner_name && (
                    <DefRow term="Owner">{property.owner_name}</DefRow>
                  )}
                  {property.zoning_code && (
                    <DefRow term="Zoning">{property.zoning_code}</DefRow>
                  )}
                  {property.land_use_code && (
                    <DefRow term="Land use">{property.land_use_code}</DefRow>
                  )}
                  {property.parcel_id && (
                    <DefRow term="Parcel ID">
                      <span className="font-mono text-xs text-fg">
                        {property.parcel_id}
                      </span>
                    </DefRow>
                  )}
                </DefList>
              </Card>
            )}

            {/* Enrichment metadata — collapsible, default closed per spec. */}
            <details className="group rounded-lg border border-border bg-surface">
              <summary className="flex cursor-pointer items-center justify-between gap-3 px-6 py-4 text-base font-semibold tracking-tight text-fg list-none [&::-webkit-details-marker]:hidden">
                Enrichment metadata
                <ChevronDown className="h-4 w-4 text-fg-muted transition-transform duration-150 group-open:rotate-180" />
              </summary>
              <div className="border-t border-border px-6 py-4 space-y-4">
                <DefList>
                  <DefRow term="Status">
                    <Badge variant={enrichmentVariant(property.enrichment_status)}>
                      {property.enrichment_status}
                    </Badge>
                  </DefRow>
                  {property.geocoded_at && (
                    <DefRow term="Geocoded">
                      <span className="font-tabular">
                        {new Date(property.geocoded_at).toLocaleDateString()}
                      </span>
                    </DefRow>
                  )}
                  {property.geocode_confidence && (
                    <DefRow term="Geocode confidence">
                      {property.geocode_confidence}
                    </DefRow>
                  )}
                  {property.address_validated_at && (
                    <DefRow term="Address validated">
                      <span className="font-tabular">
                        {new Date(property.address_validated_at).toLocaleDateString()}
                      </span>
                    </DefRow>
                  )}
                  {property.address_validation_verdict && (
                    <DefRow term="Validation verdict">
                      {property.address_validation_verdict}
                    </DefRow>
                  )}
                  {property.last_enriched_at && (
                    <DefRow term="Last enriched">
                      <span className="font-tabular">
                        {new Date(property.last_enriched_at).toLocaleDateString()}
                      </span>
                    </DefRow>
                  )}
                </DefList>

                {enrichMsg && (
                  <p
                    role="status"
                    className={cn(
                      'rounded-md border px-3 py-2 text-sm',
                      enrichMsg.toLowerCase().includes('failed')
                        ? 'border-danger/20 bg-danger-subtle text-danger'
                        : 'border-success/20 bg-success-subtle text-success'
                    )}
                  >
                    {enrichMsg}
                  </p>
                )}

                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleEnrich}
                  loading={enriching}
                >
                  Re-enrich this property
                </Button>
              </div>
            </details>
          </aside>
        </div>
      </div>

      <AddressEditDialog
        open={addressDialogOpen}
        onClose={() => setAddressDialogOpen(false)}
        propertyId={property.property_id}
        current={{
          address_line1: property.address_line1,
          address_line2: property.address_line2,
          city: property.city,
          state: property.state,
          postal_code: property.postal_code,
        }}
        onSaved={() => {
          setAddressDialogOpen(false)
          reload()
        }}
      />

      <ServiceLocationEditDialog
        open={editingSL !== null}
        onClose={() => setEditingSL(null)}
        serviceLocation={editingSL}
        clientId={property.client_id ?? ''}
        onSaved={(cascadeInfo) => {
          setEditingSL(null)
          setCascade(cascadeInfo)
          reload()
        }}
      />
    </AppShell>
  )
}

// ─── Local helpers ──────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
      {children}
    </p>
  )
}

function ExternalAnchor({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
    >
      {children}
      <ExternalLink className="h-3 w-3" />
    </a>
  )
}

function DefList({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <dl
      className={cn(
        'grid grid-cols-[7rem_1fr] gap-x-4 gap-y-2.5 text-sm',
        className
      )}
    >
      {children}
    </dl>
  )
}

function DefRow({
  term,
  children,
}: {
  term: string
  children: React.ReactNode
}) {
  return (
    <>
      <dt className="text-fg-muted">{term}</dt>
      <dd className="text-fg">{children}</dd>
    </>
  )
}

function enrichmentVariant(status: string): BadgeProps['variant'] {
  if (status === 'enriched') return 'success'
  if (status === 'failed') return 'danger'
  return 'warning'
}

function statusBadgeVariant(
  status: ServiceLocation['status']
): BadgeProps['variant'] {
  if (status === 'active') return 'success'
  if (status === 'paused') return 'warning'
  if (status === 'terminated') return 'danger'
  return 'default'
}

function severityVariant(
  severity: 'low' | 'medium' | 'high'
): BadgeProps['variant'] {
  if (severity === 'high') return 'danger'
  if (severity === 'medium') return 'warning'
  return 'default'
}

function riskVariant(score: number): BadgeProps['variant'] {
  if (score >= 6) return 'danger'
  if (score >= 3) return 'warning'
  if (score >= 1) return 'warning'
  return 'success'
}

function riskLabel(score: number): string {
  if (score >= 6) return 'High risk'
  if (score >= 3) return 'Elevated'
  if (score >= 1) return 'Mild'
  return 'No risk'
}
