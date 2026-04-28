/**
 * GET /api/v1/parcels/coverage/check
 *
 * Query params (one of):
 *   lat + lng  — check coverage for a specific coordinate
 *   state + county_name — check coverage by name
 *
 * Response: { covered: boolean, county_fips: string|null, source_refresh_date: string|null }
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import { getCountyFips } from '../../../../src/lib/parcel/fips.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const db = createAdminClient()
  const { lat, lng, state, county_name } = req.query

  let countyFips: string | null = null

  if (lat && lng) {
    const fips = await getCountyFips(Number(lat), Number(lng), db)
    countyFips = fips?.county_fips ?? null
  } else if (state && county_name) {
    // Look up by state + county_name from our import records
    const { data } = await db
      .from('parcel_county_imports')
      .select('county_fips')
      .ilike('state', String(state))
      .ilike('county_name', String(county_name))
      .eq('status', 'completed')
      .limit(1)
      .maybeSingle()

    countyFips = data?.county_fips ?? null
  } else {
    return res
      .status(400)
      .json({ error: 'Provide lat+lng or state+county_name query params' })
  }

  if (!countyFips) {
    return res.status(200).json({ covered: false, county_fips: null, source_refresh_date: null })
  }

  // Check if we have a completed import for this county
  const { data: importRow } = await db
    .from('parcel_county_imports')
    .select('county_fips, source_refresh_date')
    .eq('county_fips', countyFips)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!importRow) {
    return res
      .status(200)
      .json({ covered: false, county_fips: countyFips, source_refresh_date: null })
  }

  return res.status(200).json({
    covered: true,
    county_fips: importRow.county_fips,
    source_refresh_date: importRow.source_refresh_date ?? null,
  })
}
