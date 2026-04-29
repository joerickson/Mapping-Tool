import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'
import { validateAddress, geocodeAddress } from '../../_lib/google-address.js'

export const config = { maxDuration: 30 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err) {
    const e = err as { statusCode?: number; message?: string }
    return res.status(e.statusCode ?? 401).json({ error: e.message ?? 'Unauthorized' })
  }

  const propertyId = req.query.propertyId as string
  const db = createAdminClient()

  const { data: property, error: fetchErr } = await db
    .from('properties')
    .select('id, address_line1, address_line2, city, state, postal_code, country')
    .eq('id', propertyId)
    .single()

  if (fetchErr || !property) return res.status(404).json({ error: 'Property not found' })

  const result: any = { property_id: propertyId }

  try {
    // Step 1: Validate address
    const validation = await validateAddress({
      address_line1: property.address_line1,
      address_line2: property.address_line2,
      city: property.city,
      state: property.state,
      postal_code: property.postal_code,
      country: property.country ?? 'US',
    })

    if (validation) {
      await db.from('properties').update({
        address_validation_result: validation.raw_response,
        address_validation_verdict: validation.verdict,
        address_validated_at: new Date().toISOString(),
        validated_address_line1: validation.validated.address_line1,
        validated_city: validation.validated.city,
        validated_state: validation.validated.state,
        validated_postal_code: validation.validated.postal_code,
        validated_country: validation.validated.country,
      }).eq('id', propertyId)
      result.validation = { verdict: validation.verdict, formatted: validation.formatted_address }
    } else {
      result.validation = { skipped: true }
    }

    // Step 2: Geocode using validated address if available, else original
    const geoInput = validation?.validated ?? {
      address_line1: property.address_line1,
      address_line2: property.address_line2,
      city: property.city,
      state: property.state,
      postal_code: property.postal_code,
      country: property.country ?? 'US',
    }

    const geo = await geocodeAddress(geoInput)

    if (geo) {
      await db.from('properties').update({
        latitude: geo.latitude,
        longitude: geo.longitude,
        geocode_source: geo.source,
        geocode_confidence: geo.confidence,
        geocoded_at: new Date().toISOString(),
        google_place_id: geo.place_id,
        enrichment_status: 'enriched',
        last_enriched_at: new Date().toISOString(),
      }).eq('id', propertyId)
      result.geocode = { lat: geo.latitude, lng: geo.longitude, confidence: geo.confidence }
    } else {
      // Validation may have run but geocoding found no results.
      // Still mark as failed — lat/lng is the minimum requirement for the map.
      await db.from('properties').update({
        enrichment_status: 'failed',
        enrichment_errors: { geocode: 'No geocoding results' },
        last_enriched_at: new Date().toISOString(),
      }).eq('id', propertyId)
      result.geocode = { skipped: true, reason: 'No results' }
    }

    return res.status(200).json(result)
  } catch (err: any) {
    await db.from('properties').update({
      enrichment_status: 'failed',
      enrichment_errors: { error: err.message ?? String(err) },
      last_enriched_at: new Date().toISOString(),
    }).eq('id', propertyId)
    return res.status(500).json({ error: err.message ?? String(err), property_id: propertyId })
  }
}
