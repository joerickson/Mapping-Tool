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
  const { data: slRows, error: slErr } = await db
    .from('service_locations')
    .select('property_id')
    .eq('client_id', clientId)
    .not('property_id', 'is', null)
  if (slErr) return res.status(500).json({ error: slErr.message })

  const propertyIds = Array.from(
    new Set((slRows ?? []).map((r: any) => r.property_id).filter(Boolean))
  ) as string[]

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
    const { data: props, error } = await db
      .from('properties')
      .select('id, enrichment_status, latitude, longitude')
      .in('id', propertyIds)
    if (error) return res.status(500).json({ error: error.message })
    const rows = (props ?? []) as Array<{
      id: string
      enrichment_status: string | null
      latitude: number | null
      longitude: number | null
    }>
    let enriched = 0
    let pending = 0
    let failed = 0
    let noCoords = 0
    for (const r of rows) {
      const s = r.enrichment_status
      if (s === 'enriched') enriched++
      else if (s === 'failed') failed++
      else pending++
      if (r.latitude == null || r.longitude == null) noCoords++
    }
    return res.status(200).json({
      total: rows.length,
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
    const { data: pendingRows, error } = await db
      .from('properties')
      .select('id')
      .in('id', propertyIds)
      .in('enrichment_status', ['pending', 'failed'])
      .limit(ENRICH_BATCH_LIMIT)
    if (error) return res.status(500).json({ error: error.message })
    const targets = (pendingRows ?? []) as Array<{ id: string }>
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
