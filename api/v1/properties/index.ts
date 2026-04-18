import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'
import { createAdminClient } from '../../_lib/supabase'
import { authenticateRequest } from '../../_lib/auth'
import { fireWebhook } from '../../_lib/webhooks'

function hashAddress(addr: string, city: string, state: string, zip: string): string {
  const normalized = [addr, city, state, zip]
    .map((s) => s.trim().toLowerCase().replace(/\s+/g, ' '))
    .join('|')
  return crypto.createHash('sha256').update(normalized).digest('hex')
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  let ctx: Awaited<ReturnType<typeof authenticateRequest>>
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const db = createAdminClient()

  // ── GET /api/v1/properties ────────────────────────────────────────────────
  if (req.method === 'GET') {
    const {
      client_id,
      category,
      bbox,
      city,
      state,
      enrichment_status,
      limit: limitParam = '100',
      offset: offsetParam = '0',
    } = req.query

    const limit = Math.min(Math.max(1, Number(limitParam)), 500)
    const offset = Math.max(0, Number(offsetParam))

    let query = db
      .from('properties')
      .select('*, service_locations(*)', { count: 'exact' })
      .range(offset, offset + limit - 1)

    if (category) {
      query = query.in('rbm_category', String(category).split(','))
    }
    if (client_id) {
      // Filter via subquery on service_locations.client_id
      const { data: sls } = await db
        .from('service_locations')
        .select('property_id')
        .in('client_id', String(client_id).split(','))
      const propIds = [...new Set((sls ?? []).map((r: any) => r.property_id))]
      if (!propIds.length) {
        return res.status(200).json({ properties: [], total_count: 0, has_more: false })
      }
      query = query.in('property_id', propIds)
    }
    if (bbox) {
      const [lat1, lng1, lat2, lng2] = String(bbox).split(',').map(Number)
      query = query
        .gte('latitude', Math.min(lat1, lat2))
        .lte('latitude', Math.max(lat1, lat2))
        .gte('longitude', Math.min(lng1, lng2))
        .lte('longitude', Math.max(lng1, lng2))
    }
    if (city) query = query.ilike('city', `%${String(city)}%`)
    if (state) query = query.ilike('state', `%${String(state)}%`)
    if (enrichment_status) query = query.eq('enrichment_status', enrichment_status)

    const { data, error, count } = await query
    if (error) return res.status(500).json({ error: error.message })

    const total_count = count ?? 0
    return res.status(200).json({
      properties: data ?? [],
      total_count,
      has_more: offset + limit < total_count,
    })
  }

  // ── POST /api/v1/properties ───────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body ?? {}

    // Accept { properties: [...] } batch or plain array or single object
    const items: any[] = Array.isArray(body)
      ? body
      : Array.isArray(body.properties)
      ? body.properties
      : [body]

    if (items.length > 500) {
      return res.status(400).json({ error: 'Batch limit is 500 properties per call' })
    }

    const results: any[] = []
    const idsForJob: string[] = []

    for (const item of items) {
      const { address_line1, city, state, postal_code, address_line2, country = 'US', client_id, ...rest } = item

      if (!address_line1 || !city || !state || !postal_code) {
        results.push({ error: 'address_line1, city, state, postal_code required' })
        continue
      }

      const addressHash = hashAddress(address_line1, city, state, postal_code)

      const { data: existing } = await db
        .from('properties')
        .select('property_id, last_enriched_at, enrichment_status')
        .eq('address_hash', addressHash)
        .maybeSingle()

      let propertyId: string
      let isNew = false

      if (existing) {
        propertyId = existing.property_id

        if (Object.keys(rest).length) {
          await db
            .from('properties')
            .update({ ...rest, updated_at: new Date().toISOString() })
            .eq('property_id', propertyId)
          fireWebhook('property.updated', {
            property_id: propertyId,
            changed_fields: Object.keys(rest),
            changed_by: ctx.userId ?? 'service',
          }).catch(() => {})
        }

        const enrichedAt = existing.last_enriched_at ? new Date(existing.last_enriched_at) : null
        const needsEnrichment = !enrichedAt || Date.now() - enrichedAt.getTime() > NINETY_DAYS_MS
        if (needsEnrichment) idsForJob.push(propertyId)
      } else {
        const { data: created, error: createErr } = await db
          .from('properties')
          .insert({
            address_line1,
            address_line2: address_line2 ?? null,
            city,
            state: state.trim().toUpperCase(),
            postal_code,
            country,
            address_hash: addressHash,
            enrichment_status: 'pending',
            ...rest,
          })
          .select('property_id')
          .single()

        if (createErr || !created) {
          results.push({ error: createErr?.message ?? 'Failed to create property' })
          continue
        }
        propertyId = created.property_id
        isNew = true
        idsForJob.push(propertyId)
      }

      results.push({ propertyId, isNew })
    }

    // Create one enrichment job for all new/stale properties in this batch
    let enrichmentJobId: string | null = null
    if (idsForJob.length) {
      const { data: job } = await db
        .from('enrichment_jobs')
        .insert({
          property_ids: idsForJob,
          status: 'queued',
          total_properties: idsForJob.length,
          processed_properties: 0,
        })
        .select('enrichment_job_id')
        .single()
      enrichmentJobId = job?.enrichment_job_id ?? null
    }

    // Build spec-compliant response
    const response = results.map((r, i) => {
      if (r.error) return r
      const needsJob = idsForJob.includes(r.propertyId)
      return {
        property_id: r.propertyId,
        enrichment_status: r.isNew ? 'pending' : 'enriched',
        enrichment_job_id: needsJob ? enrichmentJobId : null,
        is_new: r.isNew,
      }
    })

    return res.status(200).json(response.length === 1 ? response[0] : response)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
