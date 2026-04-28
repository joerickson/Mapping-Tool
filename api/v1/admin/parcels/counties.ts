/**
 * GET  /api/v1/admin/parcels/counties  — list imported counties
 * DELETE /api/v1/admin/parcels/counties?county_fips=XXXXX — remove all parcels for a county
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase'
import { authenticateRequest } from '../../../_lib/auth'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  let ctx
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  if (ctx.mode !== 'user') return res.status(403).json({ error: 'Forbidden' })

  const db = createAdminClient()

  if (req.method === 'GET') {
    // Aggregate parcel counts per county from the latest completed import
    const { data: imports, error } = await db
      .from('parcel_county_imports')
      .select('county_fips, county_name, state, source_refresh_date, parcel_count, completed_at')
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })

    if (error) return res.status(500).json({ error: error.message })

    // Deduplicate — keep the latest completed import per county
    const seen = new Set<string>()
    const counties = []
    for (const row of imports ?? []) {
      if (!seen.has(row.county_fips)) {
        seen.add(row.county_fips)
        counties.push({
          county_fips: row.county_fips,
          county_name: row.county_name,
          state: row.state,
          source_refresh_date: row.source_refresh_date,
          parcel_count: row.parcel_count ?? 0,
          last_imported: row.completed_at,
        })
      }
    }

    return res.status(200).json({ counties })
  }

  if (req.method === 'DELETE') {
    const { county_fips } = req.query
    if (!county_fips || typeof county_fips !== 'string') {
      return res.status(400).json({ error: 'county_fips query param required' })
    }

    const { error: delErr } = await db
      .from('parcels')
      .delete()
      .eq('county_fips', county_fips)

    if (delErr) return res.status(500).json({ error: delErr.message })

    await db
      .from('parcel_county_imports')
      .update({ status: 'failed' }) // soft-mark as deleted
      .eq('county_fips', county_fips)
      .eq('status', 'completed')

    return res.status(200).json({ deleted: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
