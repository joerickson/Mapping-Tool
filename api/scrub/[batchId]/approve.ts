import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'
import { createAdminClient } from '../../_lib/supabase'
import { verifyAuth, unauthorized } from '../../_lib/auth'
import { runEnrichmentJob } from '../../../src/lib/enrichment/orchestrator'
import { parcelLookup } from '../../../src/lib/parcel/lookup'

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

  const batchId = req.query.batchId as string
  if (!batchId) return res.status(400).json({ error: 'batchId required' })

  const db = createAdminClient()

  // Verify no unresolved needs_review rows remain
  const { data: blocking } = await db
    .from('staged_addresses')
    .select('staged_id')
    .eq('upload_batch_id', batchId)
    .eq('scrub_status', 'needs_review')
    .is('user_action', null)
    .limit(1)

  if (blocking?.length) {
    return res.status(400).json({
      error: 'All "needs review" rows must be resolved or skipped before proceeding',
    })
  }

  // Load approved rows (clean, auto_corrected, treat_as_new; skip duplicates/existing/skip/rejected)
  const { data: staged, error: stageErr } = await db
    .from('staged_addresses')
    .select('*')
    .eq('upload_batch_id', batchId)
    .in('scrub_status', ['clean', 'auto_corrected', 'needs_review'])
    .not('user_action', 'eq', 'skip')

  if (stageErr) return res.status(500).json({ error: stageErr.message })
  if (!staged?.length) return res.status(400).json({ error: 'No rows to process' })

  // Fetch column mapping once
  const { data: batchData } = await db
    .from('upload_batches')
    .select('column_mapping, client_id')
    .eq('upload_batch_id', batchId)
    .single()
  const columnMapping = (batchData?.column_mapping ?? {}) as Record<string, string>
  const batchClientId = (batchData?.client_id as string | null) ?? null

  const propertyIds: string[] = []

  for (const row of staged) {
    // Use user-edited address if present, otherwise validated_address
    const addr = (row.user_edited_address ?? row.validated_address) as Record<string, string> | null
    if (!addr) continue

    const addr1 = (addr.address_line1 ?? '').trim()
    const city = (addr.city ?? '').trim()
    const state = (addr.state ?? '').trim().toUpperCase()
    const zip = (addr.postal_code ?? '').trim()
    if (!addr1 || !city || !state || !zip) continue

    const addressHash = hashAddress(addr1, city, state, zip)

    const { data: existing } = await db
      .from('properties')
      .select('property_id, last_enriched_at')
      .eq('address_hash', addressHash)
      .maybeSingle()

    let propertyId: string

    if (existing) {
      propertyId = existing.property_id
      const enrichedAt = existing.last_enriched_at ? new Date(existing.last_enriched_at) : null
      const isStale = !enrichedAt || Date.now() - enrichedAt.getTime() > 90 * 24 * 60 * 60 * 1000
      if (!isStale) {
        propertyIds.push(propertyId)
        continue
      }
    } else {
      const originalRow = row.original_row as Record<string, unknown>
      const mapping = columnMapping

      // Carry forward geocode data from Stage 0c if Google Address Validation already geocoded this address
      const geocodeFromStage0 = row.latitude && row.longitude
        ? {
            latitude: row.latitude as number,
            longitude: row.longitude as number,
            geocoded_at: (row.geocoded_at as string | null) ?? new Date().toISOString(),
            geocode_source: (row.geocode_source as string | null) ?? 'google_address_validation',
          }
        : {}

      const { data: newProp, error: propErr } = await db
        .from('properties')
        .insert({
          address_line1: addr1,
          address_line2: addr.address_line2 ?? null,
          city,
          state,
          postal_code: zip,
          address_hash: addressHash,
          ...geocodeFromStage0,
          enrichment_status: row.latitude && row.longitude ? 'geocoded' : 'pending',
        })
        .select('property_id')
        .single()

      if (propErr || !newProp) continue
      propertyId = newProp.property_id

      await db.from('service_locations').insert({
        property_id: propertyId,
        client_id: batchClientId,
        location_code: mapping.location_code ? String(originalRow[mapping.location_code] ?? '').trim() || null : null,
        display_name: mapping.display_name ? String(originalRow[mapping.display_name] ?? '').trim() || null : null,
        suite_or_floor: mapping.suite_or_floor ? String(originalRow[mapping.suite_or_floor] ?? '').trim() || null : null,
        serviceable_sqft: mapping.serviceable_sqft && originalRow[mapping.serviceable_sqft]
          ? Number(originalRow[mapping.serviceable_sqft]) || null
          : null,
        status: 'active',
      })
    }

    propertyIds.push(propertyId)
  }

  // Count how many address validation calls were made for this batch (for cost tracking)
  const { count: validationCallCount } = await db
    .from('staged_addresses')
    .select('staged_id', { count: 'exact', head: true })
    .eq('upload_batch_id', batchId)
    .not('validation_granularity', 'is', null)

  const { data: job, error: jobErr } = await db
    .from('enrichment_jobs')
    .insert({
      upload_batch_id: batchId,
      property_ids: propertyIds,
      status: 'queued',
      total_properties: propertyIds.length,
      processed_properties: 0,
      ...(validationCallCount ? { api_calls: { address_validation: validationCallCount } } : {}),
    })
    .select('enrichment_job_id')
    .single()

  if (jobErr) return res.status(500).json({ error: jobErr.message })

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
        parcelLookupFn: (propertyId, lat, lng) =>
          parcelLookup(lat, lng, {
            db,
            regridApiKey: process.env.REGRID_API_KEY ?? '',
            propertyId,
          }),
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
    } catch {
      await db
        .from('enrichment_jobs')
        .update({ status: 'failed' })
        .eq('enrichment_job_id', jobId)
    }
  })()

  return res.status(200).json({ jobId, propertyCount: propertyIds.length })
}
