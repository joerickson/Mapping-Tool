import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../_lib/supabase.js'
import { authenticateRequest } from '../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const db = createAdminClient()
  const { property_ids, lat, lng, radius_miles: radiusParam = '15' } = req.query

  const radiusMiles = Math.min(Math.max(0.1, Number(radiusParam)), 200)

  // Build query points
  type QueryPoint = { lat: number; lng: number; property_id?: string }
  const queryPoints: QueryPoint[] = []

  if (property_ids) {
    const ids = String(property_ids).split(',').filter(Boolean)
    const { data: props } = await db
      .from('properties')
      .select('id, latitude, longitude')
      .in('id', ids)
      .not('latitude', 'is', null)

    for (const p of props ?? []) {
      queryPoints.push({ lat: (p as any).latitude, lng: (p as any).longitude, property_id: (p as any).id })
    }
  } else if (lat && lng) {
    queryPoints.push({ lat: Number(lat), lng: Number(lng) })
  } else {
    return res.status(400).json({ error: 'Provide property_ids or lat+lng' })
  }

  if (!queryPoints.length) {
    return res.status(200).json({ query_points: [], results: [] })
  }

  const results = await Promise.all(
    queryPoints.map(async (qp) => {
      const { data, error } = await db.rpc('nearby_properties', {
        query_lat: qp.lat,
        query_lng: qp.lng,
        radius_mi: radiusMiles,
      })

      if (error || !data) return { query_point: qp, nearby: [] }

      const nearby = (data as any[]).map((row: any) => ({
        property_id: row.property_id,
        distance_miles: Math.round(row.distance_miles * 100) / 100,
        nearby_service_locations_count: (row.service_locations as any[]).length,
        nearby_service_locations: row.service_locations,
        closest_miles: Math.round(row.distance_miles * 100) / 100,
      }))

      return {
        query_point: qp,
        property_id: qp.property_id,
        nearby_service_locations_count: nearby.reduce(
          (sum: number, r: any) => sum + r.nearby_service_locations_count,
          0
        ),
        nearby_service_locations: nearby.flatMap((r: any) => r.nearby_service_locations),
        closest_miles: nearby[0]?.closest_miles ?? null,
        results: nearby,
      }
    })
  )

  return res.status(200).json({
    query_points: queryPoints,
    results,
  })
}
