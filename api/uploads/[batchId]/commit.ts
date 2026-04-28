import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'

export const config = { maxDuration: 300 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let auth: Awaited<ReturnType<typeof authenticateRequest>>
  try {
    auth = await authenticateRequest(req)
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string }
    return res.status(e.statusCode ?? 401).json({ error: e.message ?? 'Unauthorized' })
  }

  const batchId = req.query.batchId as string
  const db = createAdminClient()

  const { data: batch, error: fetchErr } = await db
    .from('upload_batches')
    .select('upload_batch_id, status, account_id, client_id, summary_stats')
    .eq('upload_batch_id', batchId)
    .single()

  if (fetchErr || !batch) return res.status(404).json({ error: 'Batch not found' })

  if (batch.status !== 'completed') {
    return res.status(400).json({ error: `Cannot commit a batch with status "${batch.status}"` })
  }

  // Fetch staged rows that should be committed
  const { data: stagedRows, error: rowsErr } = await db
    .from('upload_staged_rows')
    .select('*')
    .eq('upload_batch_id', batchId)
    .in('outcome', ['valid', 'corrected', 'duplicate_existing'])
    .order('sheet_name')
    .order('row_index')

  if (rowsErr) return res.status(500).json({ error: rowsErr.message })
  if (!stagedRows?.length) {
    return res.status(400).json({ error: 'No committable rows found' })
  }

  let newProperties = 0
  let existingProperties = 0
  let newServiceLocations = 0
  let updatedServiceLocations = 0

  // Batch deduplication cache: dedupe_hash → property_id within this commit
  const dedupeCache = new Map<string, string>()

  for (const row of stagedRows) {
    const pd = row.property_data as Record<string, unknown>
    const sld = row.service_location_data as Record<string, unknown>

    let propertyId: string | null = row.existing_property_id as string | null

    if (propertyId) {
      existingProperties++
    } else if (row.dedupe_hash && dedupeCache.has(row.dedupe_hash as string)) {
      propertyId = dedupeCache.get(row.dedupe_hash as string)!
      existingProperties++
    } else {
      // Insert new property
      const { data: prop, error: propErr } = await db
        .from('properties')
        .insert({
          address_line1: pd.address_line1 as string,
          address_line2: (pd.address_line2 as string | null) ?? null,
          city: pd.city as string,
          state: pd.state as string,
          postal_code: (pd.postal_code as string) ?? '',
          address_hash: (row.dedupe_hash as string) ?? '',
          client_id: batch.client_id as string | null,
          enrichment_status: 'pending',
        })
        .select('property_id')
        .single()

      if (propErr || !prop) {
        // If unique constraint violation (race condition), try to fetch existing
        if (propErr?.code === '23505' && row.dedupe_hash) {
          const { data: existing } = await db
            .from('properties')
            .select('property_id')
            .eq('address_hash', row.dedupe_hash as string)
            .eq('client_id', batch.client_id as string)
            .maybeSingle()
          if (existing) {
            propertyId = existing.property_id
            existingProperties++
          }
        }
        if (!propertyId) continue
      } else {
        propertyId = prop.property_id
        if (row.dedupe_hash) dedupeCache.set(row.dedupe_hash as string, propertyId!)
        newProperties++
      }
    }

    if (!propertyId) continue

    // Check if service_location already exists (same property + service_offering + client)
    const serviceOfferingId = row.service_offering_id as string | null
    if (serviceOfferingId) {
      const { data: existingSL } = await db
        .from('service_locations')
        .select('service_location_id')
        .eq('property_id', propertyId)
        .eq('service_offering_id', serviceOfferingId)
        .eq('client_id', batch.client_id as string)
        .maybeSingle()

      if (existingSL) {
        // Update existing service_location
        await db
          .from('service_locations')
          .update({
            display_name: (sld.display_name as string | null) ?? null,
            suite_or_floor: (sld.suite_or_floor as string | null) ?? null,
            serviceable_sqft: (sld.serviceable_sqft as number | null) ?? null,
            custom_fields: (sld.custom_fields as Record<string, unknown>) ?? {},
            frequency_notes: (sld.frequency_notes as string | null) ?? null,
          })
          .eq('service_location_id', existingSL.service_location_id)

        updatedServiceLocations++

        await db
          .from('upload_staged_rows')
          .update({ service_location_id: existingSL.service_location_id, property_id: propertyId })
          .eq('id', row.id)
      } else {
        const { data: sl } = await db
          .from('service_locations')
          .insert({
            property_id: propertyId,
            client_id: batch.client_id as string | null,
            account_id: batch.account_id as string | null,
            service_offering_id: serviceOfferingId,
            display_name: (sld.display_name as string | null) ?? null,
            location_code: (sld.location_code as string | null) ?? null,
            suite_or_floor: (sld.suite_or_floor as string | null) ?? null,
            serviceable_sqft: (sld.serviceable_sqft as number | null) ?? null,
            custom_fields: (sld.custom_fields as Record<string, unknown>) ?? {},
            frequency_notes: (sld.frequency_notes as string | null) ?? null,
            status: 'active',
          })
          .select('service_location_id')
          .single()

        if (sl) {
          newServiceLocations++
          await db
            .from('upload_staged_rows')
            .update({ service_location_id: sl.service_location_id, property_id: propertyId })
            .eq('id', row.id)
        }
      }
    }
  }

  await db
    .from('upload_batches')
    .update({
      status: 'committed',
      committed_at: new Date().toISOString(),
      summary_stats: {
        ...((batch.summary_stats as Record<string, unknown>) ?? {}),
        committed_new_properties: newProperties,
        committed_existing_properties: existingProperties,
        committed_new_service_locations: newServiceLocations,
        committed_updated_service_locations: updatedServiceLocations,
      },
    })
    .eq('upload_batch_id', batchId)

  return res.status(200).json({
    batch_id: batchId,
    status: 'committed',
    new_properties: newProperties,
    existing_properties: existingProperties,
    new_service_locations: newServiceLocations,
    updated_service_locations: updatedServiceLocations,
  })
}
