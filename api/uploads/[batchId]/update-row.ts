import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'
import { normalizeAddress, computeDedupeHash } from '../../_lib/address.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string }
    return res.status(e.statusCode ?? 401).json({ error: e.message ?? 'Unauthorized' })
  }

  const batchId = req.query.batchId as string
  const body = (req.body ?? {}) as {
    row_id?: string
    property_data?: Record<string, unknown>
    service_location_data?: Record<string, unknown>
  }
  const { row_id, property_data, service_location_data } = body

  if (!row_id) return res.status(400).json({ error: 'row_id is required' })
  if (!property_data || typeof property_data !== 'object') {
    return res.status(400).json({ error: 'property_data is required' })
  }

  const addr1 = String(property_data.address_line1 ?? '').trim()
  const city = String(property_data.city ?? '').trim()
  const state = String(property_data.state ?? '').trim()
  if (!addr1) return res.status(400).json({ error: 'address_line1 is required' })
  if (!city) return res.status(400).json({ error: 'city is required' })
  if (!state) return res.status(400).json({ error: 'state is required' })

  const db = createAdminClient()

  const { data: row, error: rowErr } = await db
    .from('upload_staged_rows')
    .select('id, upload_batch_id, service_location_id, property_data, service_location_data')
    .eq('id', row_id)
    .single()
  if (rowErr || !row) return res.status(404).json({ error: 'Row not found' })
  if (row.upload_batch_id !== batchId) {
    return res.status(404).json({ error: 'Row does not belong to this batch' })
  }
  if (row.service_location_id) {
    return res.status(400).json({ error: 'Row has already been committed' })
  }

  // Re-normalize the address and recompute the dedupe hash so the edit dedupes
  // consistently with the original import.
  const norm = normalizeAddress(property_data)
  const dedupe_hash = computeDedupeHash(norm.address_line1, norm.city, norm.state, norm.postal_code)

  const newPropertyData = {
    ...(row.property_data as Record<string, unknown>),
    ...property_data,
    address_line1: norm.address_line1,
    address_line2: norm.address_line2,
    city: norm.city,
    state: norm.state,
    postal_code: norm.postal_code,
    country: norm.country,
  }

  const newServiceLocationData =
    service_location_data && typeof service_location_data === 'object'
      ? { ...(row.service_location_data as Record<string, unknown>), ...service_location_data }
      : (row.service_location_data as Record<string, unknown>)

  // Editing invalidates any prior existing-property match, so clear it and let
  // commit re-evaluate the (possibly new) address fresh — otherwise commit.ts
  // would trust a stale existing_property_id and misroute the row.
  const { error: updErr } = await db
    .from('upload_staged_rows')
    .update({
      property_data: newPropertyData,
      service_location_data: newServiceLocationData,
      dedupe_hash,
      existing_property_id: null,
    })
    .eq('id', row_id)

  if (updErr) return res.status(500).json({ error: updErr.message })

  return res.status(200).json({
    id: row_id,
    property_data: newPropertyData,
    service_location_data: newServiceLocationData,
    dedupe_hash,
  })
}
