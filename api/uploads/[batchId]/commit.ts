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

  // Pre-fetch service offering names for display_name fallback
  const uniqueOfferingIds = [...new Set(
    stagedRows.map((r: any) => r.service_offering_id as string | null).filter(Boolean) as string[]
  )]
  const offeringNameMap = new Map<string, string>()
  if (uniqueOfferingIds.length) {
    const { data: offerings } = await db
      .from('service_offerings')
      .select('id, name')
      .in('id', uniqueOfferingIds)
    for (const o of offerings ?? []) {
      offeringNameMap.set(o.id, o.name)
    }
  }

  let newProperties = 0
  let existingProperties = 0
  let newServiceLocations = 0
  let updatedServiceLocations = 0
  const failedRows: Array<{ staged_row_id: string; reason: string }> = []

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
      // Insert new property — properties table PK is `id`
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
        .select('id')
        .single()

      if (propErr) {
        console.error(`Property insert failed for staged_row ${row.id}:`, {
          error: propErr,
          address: pd.address_line1,
          city: pd.city,
          state: pd.state,
          address_hash: row.dedupe_hash,
        })
        // Race-condition recovery on unique constraint violation
        if (propErr.code === '23505' && row.dedupe_hash) {
          const { data: existing } = await db
            .from('properties')
            .select('id')
            .eq('address_hash', row.dedupe_hash as string)
            .eq('client_id', batch.client_id as string)
            .maybeSingle()
          if (existing) {
            propertyId = existing.id as string
            existingProperties++
          }
        }
        if (!propertyId) {
          failedRows.push({ staged_row_id: row.id as string, reason: propErr.message })
          continue
        }
      } else if (prop) {
        propertyId = prop.id as string
        if (row.dedupe_hash) dedupeCache.set(row.dedupe_hash as string, propertyId!)
        newProperties++
      } else {
        failedRows.push({ staged_row_id: row.id as string, reason: 'Property insert returned no data' })
        continue
      }
    }

    if (!propertyId) continue

    const serviceOfferingId = row.service_offering_id as string | null
    if (serviceOfferingId) {
      // Lookup existing — service_locations PK is `id`
      const { data: existingSL, error: slLookupErr } = await db
        .from('service_locations')
        .select('id')
        .eq('property_id', propertyId)
        .eq('service_offering_id', serviceOfferingId)
        .eq('client_id', batch.client_id as string)
        .maybeSingle()

      if (slLookupErr) {
        console.error(`Service location lookup failed for staged_row ${row.id}:`, {
          error: slLookupErr,
          property_id: propertyId,
          service_offering_id: serviceOfferingId,
        })
        failedRows.push({ staged_row_id: row.id as string, reason: slLookupErr.message })
        continue
      }

      if (existingSL) {
        const { error: slUpdateErr } = await db
          .from('service_locations')
          .update({
            display_name: (sld.display_name as string | null)?.trim() ?? null,
            suite_or_floor: (sld.suite_or_floor as string | null) ?? null,
            serviceable_sqft: (sld.serviceable_sqft as number | null) ?? null,
            custom_fields: (sld.custom_fields as Record<string, unknown>) ?? {},
            frequency_notes: (sld.frequency_notes as string | null) ?? null,
          })
          .eq('id', existingSL.id as string)

        if (slUpdateErr) {
          console.error(`Service location update failed for staged_row ${row.id}:`, {
            error: slUpdateErr,
            service_location_id: existingSL.id,
            property_id: propertyId,
          })
          failedRows.push({ staged_row_id: row.id as string, reason: slUpdateErr.message })
          continue
        }

        updatedServiceLocations++

        // upload_staged_rows.service_location_id IS the column on staged_rows (correct as-is)
        await db
          .from('upload_staged_rows')
          .update({ service_location_id: existingSL.id, property_id: propertyId })
          .eq('id', row.id)
      } else {
        const serviceOfferingName = offeringNameMap.get(serviceOfferingId) ?? serviceOfferingId
        const displayName =
          (sld.display_name as string | null)?.trim() ||
          `${pd.address_line1} - ${serviceOfferingName}` ||
          String(pd.address_line1)

        const { data: sl, error: slInsertErr } = await db
          .from('service_locations')
          .insert({
            property_id: propertyId,
            client_id: batch.client_id as string | null,
            account_id: batch.account_id as string | null,
            service_offering_id: serviceOfferingId,
            display_name: displayName,
            location_code: (sld.location_code as string | null) ?? null,
            suite_or_floor: (sld.suite_or_floor as string | null) ?? null,
            serviceable_sqft: (sld.serviceable_sqft as number | null) ?? null,
            custom_fields: (sld.custom_fields as Record<string, unknown>) ?? {},
            frequency_notes: (sld.frequency_notes as string | null) ?? null,
            status: 'active',
          })
          .select('id')
          .single()

        if (slInsertErr) {
          console.error(`Service location insert failed for staged_row ${row.id}:`, {
            error: slInsertErr,
            property_id: propertyId,
            service_offering_id: serviceOfferingId,
            display_name: displayName,
          })
          failedRows.push({ staged_row_id: row.id as string, reason: slInsertErr.message })
          continue
        }

        if (sl) {
          newServiceLocations++
          await db
            .from('upload_staged_rows')
            .update({ service_location_id: sl.id, property_id: propertyId })
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
        commit_failure_count: failedRows.length,
        commit_failures: failedRows.slice(0, 50),
      },
    })
    .eq('upload_batch_id', batchId)

  // Fire-and-forget enrichment for newly-created properties.
  // Note: Vercel Node functions may not reliably execute async work after res.send().
  // If this proves unreliable, use the manual "Enrich Pending Properties" button on /admin.
  const newPropertyIds = Array.from(dedupeCache.values())
  if (newPropertyIds.length > 0) {
    const baseUrl = process.env.VITE_APP_URL || `https://${req.headers.host}`
    const enrichInBackground = async () => {
      const concurrency = 10
      for (let i = 0; i < newPropertyIds.length; i += concurrency) {
        const chunk = newPropertyIds.slice(i, i + concurrency)
        await Promise.allSettled(
          chunk.map((propId) =>
            fetch(`${baseUrl}/api/properties/${propId}/enrich`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-RBM-Service-Key': process.env.SERVICE_API_KEY ?? '',
              },
            }).catch(() => {}) // swallow — admin can retry from /admin
          )
        )
      }
    }
    enrichInBackground()
  }

  return res.status(200).json({
    batch_id: batchId,
    status: 'committed',
    new_properties: newProperties,
    existing_properties: existingProperties,
    new_service_locations: newServiceLocations,
    updated_service_locations: updatedServiceLocations,
    failed_rows: failedRows,
    failure_count: failedRows.length,
  })
}
