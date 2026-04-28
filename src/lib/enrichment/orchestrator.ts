import { geocodeBatch } from './geocode'
import { enrichWithPlaces } from './places'
import { classifyProperty } from './classify'
import type { Property, RbmCategory } from '../../types'
import type { ParcelLookupResult } from '../parcel/lookup'

export type { ParcelLookupResult }

export interface OrchestratorConfig {
  googleMapsApiKey: string
  anthropicApiKey: string
  /** Called for Stage 3; returns source, parcel data, and cost */
  parcelLookupFn: (
    propertyId: string,
    lat: number,
    lng: number
  ) => Promise<ParcelLookupResult>
  supabaseUpdate: (propertyId: string, data: Partial<Property>) => Promise<void>
  supabaseGet: (propertyId: string) => Promise<Property | null>
  getCategories: () => Promise<RbmCategory[]>
  updateJobProgress: (
    jobId: string,
    processed: number,
    costDelta: number,
    apiCallsDelta?: Record<string, number>
  ) => Promise<void>
}

export async function runEnrichmentJob(
  jobId: string,
  propertyIds: string[],
  config: OrchestratorConfig
): Promise<void> {
  const categories = await config.getCategories()
  let processed = 0
  let totalCost = 0

  const properties = await Promise.all(propertyIds.map((id) => config.supabaseGet(id)))
  const validProps = properties.filter((p): p is Property => p !== null)

  // Stage 1: Geocode — skip any property that Stage 0c already geocoded
  const needsGeocode = validProps.filter((p) => !p.latitude || !p.longitude)
  const alreadyGeocoded = validProps.filter((p) => p.latitude && p.longitude)

  const geocodeResults = await geocodeBatch(needsGeocode, config.googleMapsApiKey, 10)

  // Inject already-geocoded properties so the rest of the pipeline can use them uniformly
  for (const property of alreadyGeocoded) {
    geocodeResults.set(property.property_id, {
      latitude: property.latitude!,
      longitude: property.longitude!,
      geocode_confidence: (property.geocode_confidence as 'rooftop' | 'range_interpolated' | 'approximate') ?? 'approximate',
      geocode_source: (property.geocode_source as 'google' | 'google_address_validation') ?? 'google_address_validation',
      geocoded_at: property.geocoded_at ?? new Date().toISOString(),
    })
    if (property.enrichment_status === 'pending') {
      await config.supabaseUpdate(property.property_id, { enrichment_status: 'geocoded' })
    }
  }

  for (const property of validProps) {
    const geoResult = geocodeResults.get(property.property_id)

    if (geoResult) {
      if (!alreadyGeocoded.includes(property)) {
        await config.supabaseUpdate(property.property_id, {
          ...geoResult,
          enrichment_status: 'geocoded',
        })
        totalCost += 0.005
      }
    } else {
      await config.supabaseUpdate(property.property_id, {
        enrichment_errors: {
          ...(property.enrichment_errors ?? {}),
          geocode: 'Geocoding failed',
        },
      })
      processed++
      await config.updateJobProgress(jobId, processed, 0.005)
      continue
    }

    const lat = geoResult.latitude
    const lng = geoResult.longitude

    // Stage 2: Google Places
    try {
      const placesResult = await enrichWithPlaces(lat, lng, config.googleMapsApiKey)
      if (placesResult) {
        await config.supabaseUpdate(property.property_id, {
          ...placesResult,
          enrichment_status: 'places_enriched',
        })
        totalCost += 0.049
      }
    } catch (err) {
      await config.supabaseUpdate(property.property_id, {
        enrichment_errors: { ...(property.enrichment_errors ?? {}), places: String(err) },
      })
    }

    // Stage 3: Parcel — local-first lookup with API fallback
    try {
      const lookup = await config.parcelLookupFn(property.property_id, lat, lng)

      if (lookup.parcel_data) {
        await config.supabaseUpdate(property.property_id, {
          parcel_id: lookup.parcel_data.parcel_id ?? null,
          parcel_polygon: (lookup.parcel_data.parcel_polygon as Property['parcel_polygon']) ?? null,
          building_sqft: lookup.parcel_data.building_sqft ?? null,
          lot_sqft: lookup.parcel_data.lot_sqft ?? null,
          year_built: lookup.parcel_data.year_built ?? null,
          zoning_code: lookup.parcel_data.zoning_code ?? null,
          land_use_code: lookup.parcel_data.land_use_code ?? null,
          owner_name: lookup.parcel_data.owner_name ?? null,
          owner_mailing_address: lookup.parcel_data.owner_mailing_address ?? null,
          enrichment_status: 'parcel_enriched',
        })
        totalCost += lookup.cost_usd
      } else if (lookup.source === 'none') {
        await config.supabaseUpdate(property.property_id, {
          enrichment_errors: {
            ...(property.enrichment_errors ?? {}),
            parcel: 'No parcel found (county purchased, no centroid match within 100m)',
          },
        })
      }

      const apiCallKey = lookup.source === 'local' ? 'parcel_local' : 'parcel_api'
      await config.updateJobProgress(jobId, processed, lookup.cost_usd, {
        [apiCallKey]: 1,
      })
    } catch (err) {
      await config.supabaseUpdate(property.property_id, {
        enrichment_errors: { ...(property.enrichment_errors ?? {}), parcel: String(err) },
      })
    }

    // Stage 4: AI Classification
    try {
      const updatedProp = await config.supabaseGet(property.property_id)
      const classResult = await classifyProperty(
        updatedProp ?? property,
        categories,
        config.anthropicApiKey
      )
      if (classResult) {
        await config.supabaseUpdate(property.property_id, {
          rbm_category: classResult.rbm_category,
          rbm_subcategory: classResult.rbm_subcategory,
          rbm_category_confidence: classResult.confidence,
          rbm_category_source: 'ai',
          enrichment_status: 'enriched',
          last_enriched_at: new Date().toISOString(),
        })
        totalCost += 0.003
      }
    } catch (err) {
      await config.supabaseUpdate(property.property_id, {
        enrichment_errors: { ...(property.enrichment_errors ?? {}), classify: String(err) },
        enrichment_status: 'enriched',
        last_enriched_at: new Date().toISOString(),
      })
    }

    processed++
    await config.updateJobProgress(jobId, processed, totalCost)
  }
}
