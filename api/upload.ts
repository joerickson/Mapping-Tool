import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'
import { createAdminClient } from './_lib/supabase'
import { verifyAuth, unauthorized } from './_lib/auth'
import { runEnrichmentJob } from '../src/lib/enrichment/orchestrator'

function hashAddress(addr: string, city: string, state: string, zip: string): string {
  const normalized = [addr, city, state, zip]
    .map((s) => s.trim().toLowerCase().replace(/\s+/g, ' '))
    .join('|')
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await verifyAuth(req)
  if (!auth.ok) return unauthorized(res, auth.error)

  const { filename, rows, mapping } = req.body ?? {}
  if (!rows?.length || !mapping) return res.status(400).json({ error: 'rows and mapping required' })

  const db = createAdminClient()

  // Store upload batch
  const { data: batch, error: batchErr } = await db
    .from('upload_batches')
    .insert({
      filename,
      row_count: rows.length,
      raw_data: rows,
      column_mapping: mapping,
      uploaded_by: auth.userId,
    })
    .select('upload_batch_id')
    .single()

  if (batchErr) return res.status(500).json({ error: batchErr.message })

  // Upsert properties (deduped by address hash)
  const propertyIds: string[] = []

  for (const row of rows) {
    const addr1 = String(row[mapping.address_line1] ?? '').trim()
    const city = String(row[mapping.city] ?? '').trim()
    const state = String(row[mapping.state] ?? '').trim().toUpperCase()
    const zip = String(row[mapping.postal_code] ?? '').trim()
    if (!addr1 || !city || !state || !zip) continue

    const addressHash = hashAddress(addr1, city, state, zip)

    // Check for existing property
    const { data: existing } = await db
      .from('properties')
      .select('property_id, last_enriched_at')
      .eq('address_hash', addressHash)
      .maybeSingle()

    let propertyId: string

    if (existing) {
      propertyId = existing.property_id
      // Re-enrich if stale (>90 days)
      const enrichedAt = existing.last_enriched_at ? new Date(existing.last_enriched_at) : null
      const isStale = !enrichedAt || Date.now() - enrichedAt.getTime() > 90 * 24 * 60 * 60 * 1000
      if (!isStale) {
        propertyIds.push(propertyId)
        continue
      }
    } else {
      const { data: newProp, error: propErr } = await db
        .from('properties')
        .insert({
          address_line1: addr1,
          address_line2: mapping.address_line2 ? String(row[mapping.address_line2] ?? '').trim() || null : null,
          city,
          state,
          postal_code: zip,
          address_hash: addressHash,
          enrichment_status: 'pending',
        })
        .select('property_id')
        .single()

      if (propErr || !newProp) continue
      propertyId = newProp.property_id
    }

    // Create service location
    await db.from('service_locations').insert({
      property_id: propertyId,
      location_code: mapping.location_code ? String(row[mapping.location_code] ?? '').trim() || null : null,
      display_name: mapping.display_name ? String(row[mapping.display_name] ?? '').trim() || null : null,
      suite_or_floor: mapping.suite_or_floor ? String(row[mapping.suite_or_floor] ?? '').trim() || null : null,
      serviceable_sqft: mapping.serviceable_sqft && row[mapping.serviceable_sqft]
        ? Number(row[mapping.serviceable_sqft]) || null
        : null,
      status: 'active',
    })

    propertyIds.push(propertyId)
  }

  // Create enrichment job
  const { data: job, error: jobErr } = await db
    .from('enrichment_jobs')
    .insert({
      upload_batch_id: batch.upload_batch_id,
      property_ids: propertyIds,
      status: 'queued',
      total_properties: propertyIds.length,
      processed_properties: 0,
    })
    .select('enrichment_job_id')
    .single()

  if (jobErr) return res.status(500).json({ error: jobErr.message })

  // Fire-and-forget enrichment (Vercel background)
  const jobId = job.enrichment_job_id
  ;(async () => {
    try {
      await db
        .from('enrichment_jobs')
        .update({ status: 'running', started_at: new Date().toISOString() })
        .eq('enrichment_job_id', jobId)

      await runEnrichmentJob(jobId, propertyIds, {
        googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY!,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
        regridApiKey: process.env.REGRID_API_KEY!,
        supabaseUpdate: async (id, data) => {
          await db.from('properties').update(data).eq('property_id', id)
        },
        supabaseGet: async (id) => {
          const { data } = await db.from('properties').select('*').eq('property_id', id).single()
          return data
        },
        getCategories: async () => {
          const { data } = await db.from('rbm_categories').select('*')
          return data ?? []
        },
        updateJobProgress: async (jid, processed, cost) => {
          await db
            .from('enrichment_jobs')
            .update({ processed_properties: processed, estimated_cost_usd: cost })
            .eq('enrichment_job_id', jid)
        },
      })

      await db
        .from('enrichment_jobs')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('enrichment_job_id', jobId)
    } catch (err) {
      await db
        .from('enrichment_jobs')
        .update({ status: 'failed' })
        .eq('enrichment_job_id', jobId)
    }
  })()

  return res.status(200).json({ jobId, batchId: batch.upload_batch_id, propertyCount: propertyIds.length })
}
