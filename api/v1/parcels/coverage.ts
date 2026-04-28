/**
 * GET /api/v1/parcels/coverage
 * Returns all counties with purchased local parcel data and aggregate totals.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase'
import { authenticateRequest } from '../../_lib/auth'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const db = createAdminClient()

  const { data: imports, error } = await db
    .from('parcel_county_imports')
    .select('county_fips, county_name, state, source_refresh_date, parcel_count, completed_at')
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })

  // Latest completed import per county
  const seen = new Set<string>()
  const counties: {
    county_fips: string
    county_name: string
    state: string
    parcel_count: number
    source_refresh_date: string | null
  }[] = []

  for (const row of imports ?? []) {
    if (!seen.has(row.county_fips)) {
      seen.add(row.county_fips)
      counties.push({
        county_fips: row.county_fips,
        county_name: row.county_name,
        state: row.state,
        parcel_count: row.parcel_count ?? 0,
        source_refresh_date: row.source_refresh_date ?? null,
      })
    }
  }

  const total_parcels = counties.reduce((s, c) => s + c.parcel_count, 0)

  return res.status(200).json({
    counties,
    total_counties: counties.length,
    total_parcels,
  })
}
