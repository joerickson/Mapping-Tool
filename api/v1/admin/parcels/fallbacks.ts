/**
 * GET  /api/v1/admin/parcels/fallbacks
 * Returns per-county API fallback usage aggregated over the last 90 days.
 *
 * POST /api/v1/admin/parcels/fallbacks/mark-purchased
 * Body: { county_fips }  — redirects to import flow (no-op here; client handles navigation)
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase'
import { authenticateRequest } from '../../../_lib/auth'

const FALLBACK_THRESHOLD = parseInt(process.env.PARCEL_FALLBACK_THRESHOLD ?? '50', 10)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  let ctx
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  if (ctx.mode !== 'user') return res.status(403).json({ error: 'Forbidden' })

  const db = createAdminClient()
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await db
    .from('parcel_api_fallbacks')
    .select('county_fips, county_name, state, api_cost_usd, called_at')
    .gte('called_at', ninetyDaysAgo)

  if (error) return res.status(500).json({ error: error.message })

  // Aggregate in JS (no GROUP BY support in Supabase client)
  const map = new Map<
    string,
    {
      county_fips: string
      county_name: string | null
      state: string | null
      total_calls: number
      total_cost_usd: number
      first_fallback: string
      last_fallback: string
    }
  >()

  for (const row of data ?? []) {
    const key = row.county_fips ?? 'unknown'
    const existing = map.get(key)

    if (!existing) {
      map.set(key, {
        county_fips: key,
        county_name: row.county_name ?? null,
        state: row.state ?? null,
        total_calls: 1,
        total_cost_usd: Number(row.api_cost_usd ?? 0),
        first_fallback: row.called_at,
        last_fallback: row.called_at,
      })
    } else {
      existing.total_calls++
      existing.total_cost_usd += Number(row.api_cost_usd ?? 0)
      if (row.called_at < existing.first_fallback) existing.first_fallback = row.called_at
      if (row.called_at > existing.last_fallback) existing.last_fallback = row.called_at
    }
  }

  const summary = Array.from(map.values()).sort((a, b) => b.total_calls - a.total_calls)

  return res.status(200).json({
    threshold: FALLBACK_THRESHOLD,
    summaries: summary,
  })
}
