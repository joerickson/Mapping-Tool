import { geocodeBatch } from './geocode'
import { enrichWithPlaces } from './places'
import { lookupParcel } from './parcel'
import { classifyProperty } from './classify'
import type { Property, RbmCategory } from '../../types'

export interface OrchestratorConfig {
  googleMapsApiKey: string
  anthropicApiKey: string
  regridApiKey: string
  supabaseUpdate: (propertyId: string, data: Partial<Property>) => Promise<void>
  supabaseGet: (propertyId: string) => Promise<Property | null>
  getCategories: () => Promise<RbmCategory[]>
  updateJobProgress: (jobId: string, processed: number, costDelta: number) => Promise<void>
}

export async function runEnrichmentJob(
  jobId: string,
  propertyIds: string[],
  config: OrchestratorConfig
): Promise<void> {
  const categories = await config.getCategories()
  let processed = 0
  let totalCost = 0

  // Stage 1: Geocode all properties in batch
  const properties = await Promise.all(
    propertyIds.map((id) => config.supabaseGet(id))
  )
  const validProps = properties.filter((p): p is Property => p !== null)

  const geocodeResults = await geocodeBatch(
    validProps,
    config.googleMapsApiKey,
    10 // concurrency
  )

  for (const property of validProps) {
    const geoResult = geocodeResults.get(property.property_id)

    if (geoResult) {
      await config.supabaseUpdate(property.property_id, {
        ...geoResult,
        enrichment_status: 'geocoded',
      })
      totalCost += 0.005 // geocode cost per property
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
    let placesResult = null
    try {
      placesResult = await enrichWithPlaces(lat, lng, config.googleMapsApiKey)
      if (placesResult) {
        await config.supabaseUpdate(property.property_id, {
          ...placesResult,
          enrichment_status: 'places_enriched',
        })
        totalCost += 0.049 // nearby + details
      }
    } catch (err) {
      await config.supabaseUpdate(property.property_id, {
        enrichment_errors: {
          ...(property.enrichment_errors ?? {}),
          places: String(err),
        },
      })
    }

    // Stage 3: Parcel
    let parcelResult = null
    try {
      parcelResult = await lookupParcel(lat, lng, config.regridApiKey)
      if (parcelResult) {
        await config.supabaseUpdate(property.property_id, {
          ...parcelResult,
          enrichment_status: 'parcel_enriched',
        })
        totalCost += 0.02
      }
    } catch (err) {
      await config.supabaseUpdate(property.property_id, {
        enrichment_errors: {
          ...(property.enrichment_errors ?? {}),
          parcel: String(err),
        },
      })
    }

    // Stage 4: AI Classification
    try {
      // Get updated property data for classification context
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
        enrichment_errors: {
          ...(property.enrichment_errors ?? {}),
          classify: String(err),
        },
        enrichment_status: 'enriched', // still mark as enriched even if classification fails
        last_enriched_at: new Date().toISOString(),
      })
    }

    processed++
    await config.updateJobProgress(jobId, processed, totalCost)
  }
}
