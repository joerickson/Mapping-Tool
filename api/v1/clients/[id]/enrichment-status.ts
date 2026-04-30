// GET  /api/v1/clients/[id]/enrichment-status
//   → per-client counts: enriched / pending / failed / total / no_coords
// POST /api/v1/clients/[id]/enrichment-status
//   → kicks off enrichment for every pending+failed property under this
//     client. Same logic as the global /api/admin/enrich-pending but
//     scoped to (client_id) via service_locations join.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'

// 5-min timeout; ~2 min to do 1000 properties at 10 concurrency.
export const config = { maxDuration: 300 }

const ENRICH_CONCURRENCY = 10
const ENRICH_BATCH_LIMIT = 2000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const clientId = req.query.id as string
  if (!clientId) return res.status(400).json({ error: 'client id required' })

  const db = createAdminClient()

  // Resolve the property ids under this client via service_locations.
  // PostgREST silently caps at ~1000 rows per response, so for clients
  // with 1000+ SLs we MUST paginate or the enrichment banner under-
  // counts and (when total ends up at the cap exactly) shows wrong
  // numbers. Loop pages of 1000 until a short page comes back.
  const SL_PAGE = 1000
  const propIdSet = new Set<string>()
  let slOffset = 0
  const MAX_SL_PAGES = 100
  for (let page = 0; page < MAX_SL_PAGES; page++) {
    const { data: slRows, error: slErr } = await db
      .from('service_locations')
      .select('property_id')
      .eq('client_id', clientId)
      .not('property_id', 'is', null)
      .range(slOffset, slOffset + SL_PAGE - 1)
    if (slErr) return res.status(500).json({ error: slErr.message })
    const batch = slRows ?? []
    for (const r of batch) {
      const id = (r as any).property_id
      if (id) propIdSet.add(id)
    }
    if (batch.length < SL_PAGE) break
    slOffset += SL_PAGE
  }
  const propertyIds = Array.from(propIdSet)

  if (req.method === 'GET') {
    if (propertyIds.length === 0) {
      return res.status(200).json({
        total: 0,
        enriched: 0,
        pending: 0,
        failed: 0,
        no_coords: 0,
      })
    }
    // Chunk the .in() to keep the PostgREST URL under its ~32KB limit.
    const PROP_ID_CHUNK = 250
    let enriched = 0
    let pending = 0
    let failed = 0
    let noCoords = 0
    let total = 0
    for (let i = 0; i < propertyIds.length; i += PROP_ID_CHUNK) {
      const chunk = propertyIds.slice(i, i + PROP_ID_CHUNK)
      const { data: props, error } = await db
        .from('properties')
        .select('id, enrichment_status, latitude, longitude')
        .in('id', chunk)
      if (error) return res.status(500).json({ error: error.message })
      const rows = (props ?? []) as Array<{
        id: string
        enrichment_status: string | null
        latitude: number | null
        longitude: number | null
      }>
      total += rows.length
      for (const r of rows) {
        const s = r.enrichment_status
        if (s === 'enriched') enriched++
        else if (s === 'failed') failed++
        else pending++
        if (r.latitude == null || r.longitude == null) noCoords++
      }
    }
    return res.status(200).json({
      total,
      enriched,
      pending,
      failed,
      no_coords: noCoords,
    })
  }

  if (req.method === 'POST') {
    if (propertyIds.length === 0) {
      return res.status(200).json({ message: 'No properties under this client', count: 0 })
    }
    // Chunk the .in() over property ids to keep the URL under
    // PostgREST's ~32KB limit for clients with many properties.
    const PROP_ID_CHUNK = 250
    const targets: Array<{ id: string }> = []
    for (let i = 0; i < propertyIds.length; i += PROP_ID_CHUNK) {
      if (targets.length >= ENRICH_BATCH_LIMIT) break
      const chunk = propertyIds.slice(i, i + PROP_ID_CHUNK)
      const { data: pendingRows, error } = await db
        .from('properties')
        .select('id')
        .in('id', chunk)
        .in('enrichment_status', ['pending', 'failed'])
      if (error) return res.status(500).json({ error: error.message })
      for (const r of (pendingRows ?? []) as Array<{ id: string }>) {
        targets.push(r)
        if (targets.length >= ENRICH_BATCH_LIMIT) break
      }
    }
    if (targets.length === 0) {
      return res.status(200).json({ message: 'No pending properties', count: 0 })
    }

    const baseUrl = process.env.VITE_APP_URL || `https://${req.headers.host}`
    let succeeded = 0
    let failedCount = 0

    for (let i = 0; i < targets.length; i += ENRICH_CONCURRENCY) {
      const chunk = targets.slice(i, i + ENRICH_CONCURRENCY)
      const results = await Promise.allSettled(
        chunk.map((p) =>
          fetch(`${baseUrl}/api/properties/${p.id}/enrich`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-RBM-Service-Key': process.env.SERVICE_API_KEY ?? '',
            },
          })
        )
      )
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.ok) succeeded++
        else failedCount++
      }
    }

    return res.status(200).json({
      total: targets.length,
      succeeded,
      failed: failedCount,
    })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
