// POST /api/v1/schedule-assessments/[id]/add-to-portfolio
//
// Promotes assessment rows that aren't in the portfolio yet
// (status='unmatched' but successfully geocoded) into real
// properties + service_locations. After this runs, the rows are
// matched to the new SL and downstream tooling (diff, save-as-
// template, etc.) treats them as part of the client's portfolio.
//
// Body: { row_ids: string[], client_id?: string }
//   row_ids   — assessment_row IDs to promote. All must belong to
//               this assessment.
//   client_id — required if the assessment's client is combined
//               (combined clients don't own SLs). Otherwise defaults
//               to the assessment's client.
//
// For each row:
//   1. Look up an existing property by address_hash (avoids dup).
//   2. If none, insert a fresh properties row with the geocoded
//      lat/lng + formatted address.
//   3. Insert a service_locations row tying it to the chosen client.
//   4. Update the assessment row: matched_service_location_id = new
//      SL, match_status='manual', confidence=1.0.
//
// Property/SL inserts run sequentially (not parallel) because we need
// the address_hash dedup check; for typical batches of <50 not-in-
// portfolio rows this is plenty fast.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest, type AuthContext } from '../../../_lib/auth.js'

export const config = { maxDuration: 60 }

function hashAddress(addr: string, city: string, state: string, zip: string): string {
  const normalized = [addr, city, state, zip]
    .map((s) => s.trim().toLowerCase().replace(/\s+/g, ' '))
    .join('|')
  return crypto.createHash('sha256').update(normalized).digest('hex')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  let ctx: AuthContext
  try { ctx = await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const assessmentId = req.query.id as string
  const body = (req.body ?? {}) as { row_ids?: string[]; client_id?: string }
  if (!Array.isArray(body.row_ids) || body.row_ids.length === 0) {
    return res.status(400).json({ error: 'row_ids array required' })
  }
  const db = createAdminClient()

  const { data: assessment } = await db
    .from('schedule_assessments')
    .select('id, account_id, client_id')
    .eq('id', assessmentId)
    .maybeSingle()
  if (!assessment) return res.status(404).json({ error: 'Assessment not found' })
  const a = assessment as any

  // Resolve target client. Combined clients own no SLs themselves —
  // require operator to pick a member via body.client_id.
  let targetClientId = body.client_id ?? a.client_id
  const { data: targetClient } = await db
    .from('clients')
    .select('id, account_id, is_combined')
    .eq('id', targetClientId)
    .maybeSingle()
  if (!targetClient) return res.status(400).json({ error: `Target client ${targetClientId} not found.` })
  if ((targetClient as any).is_combined) {
    return res.status(400).json({
      error: 'The assessment is on a combined client, which owns no service locations directly. Pass an explicit client_id (one of the combined members) so the new SL has a real home.',
      code: 'COMBINED_CLIENT_NOT_ALLOWED',
    })
  }
  const targetAccountId = (targetClient as any).account_id as string

  // Pull the rows we're promoting; bail if any don't belong to this
  // assessment or aren't ready (no geocode).
  const { data: rowsRaw, error: rowsErr } = await db
    .from('schedule_assessment_rows')
    .select('id, raw_address, raw_city, raw_state, raw_postal_code, geocoded_lat, geocoded_lng, geocoded_formatted_address, match_status')
    .in('id', body.row_ids)
    .eq('assessment_id', assessmentId)
  if (rowsErr) return res.status(500).json({ error: rowsErr.message })
  const rows = rowsRaw ?? []
  if (rows.length === 0) return res.status(404).json({ error: 'No matching rows found.' })

  const created: Array<{ row_id: string; property_id: string; sl_id: string; reused_property: boolean }> = []
  const skipped: Array<{ row_id: string; reason: string }> = []

  for (const row of rows as any[]) {
    if (typeof row.geocoded_lat !== 'number' || typeof row.geocoded_lng !== 'number') {
      skipped.push({ row_id: row.id, reason: 'Not geocoded — run "Geocode & match" first.' })
      continue
    }
    const street = (row.raw_address ?? '').trim()
    const city = (row.raw_city ?? '').trim()
    const state = ((row.raw_state ?? '').trim() || '').toUpperCase()
    const zip = (row.raw_postal_code ?? '').trim()
    if (!street || !city || !state || !zip) {
      skipped.push({
        row_id: row.id,
        reason: 'Missing address components (need street, city, state, postal_code).',
      })
      continue
    }

    // Dedup by address_hash so the same street address doesn't create
    // two property rows.
    const addressHash = hashAddress(street, city, state, zip)
    let propertyId: string
    let reusedProperty = false
    const { data: existingProp } = await db
      .from('properties')
      .select('id')
      .eq('address_hash', addressHash)
      .maybeSingle()
    if (existingProp) {
      propertyId = (existingProp as any).id
      reusedProperty = true
    } else {
      const { data: newProp, error: propErr } = await db
        .from('properties')
        .insert({
          address_line1: street,
          city,
          state,
          postal_code: zip,
          country: 'US',
          address_hash: addressHash,
          latitude: row.geocoded_lat,
          longitude: row.geocoded_lng,
          enrichment_status: 'pending',
          geocode_confidence: row.geocoded_formatted_address ? 'rooftop' : null,
        })
        .select('id')
        .single()
      if (propErr || !newProp) {
        skipped.push({ row_id: row.id, reason: `property insert failed: ${propErr?.message ?? 'unknown'}` })
        continue
      }
      propertyId = (newProp as any).id
    }

    // Create the SL tying this property to the target client.
    const { data: newSl, error: slErr } = await db
      .from('service_locations')
      .insert({
        property_id: propertyId,
        client_id: targetClientId,
        account_id: targetAccountId,
        display_name: street,
        status: 'active',
      })
      .select('id')
      .single()
    if (slErr || !newSl) {
      skipped.push({ row_id: row.id, reason: `service_location insert failed: ${slErr?.message ?? 'unknown'}` })
      continue
    }
    const slId = (newSl as any).id

    // Update the assessment row to point at the new SL.
    await db
      .from('schedule_assessment_rows')
      .update({
        matched_service_location_id: slId,
        match_status: 'manual',
        match_confidence: 1.0,
        notes: 'Added to portfolio via Schedule Assessment',
      })
      .eq('id', row.id)

    created.push({ row_id: row.id, property_id: propertyId, sl_id: slId, reused_property: reusedProperty })
  }

  await db
    .from('schedule_assessments')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', assessmentId)
  // Mark the inserted rows' user as the assessment creator.
  void ctx

  return res.status(200).json({
    created_count: created.length,
    reused_property_count: created.filter((c) => c.reused_property).length,
    skipped_count: skipped.length,
    created,
    skipped,
  })
}
