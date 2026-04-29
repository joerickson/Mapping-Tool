// POST /api/analyses/[accountId]/risk-flags-bulk
// Bulk-assess risk flags for every property tied to this account. Concurrency
// is bounded. Runs synchronously inside the request so the dashboard knows
// when it's actually done — fire-and-forget after res.end() is unreliable on
// Vercel and was leaving runs half-finished.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import { loadAccountProperties } from '../../../_lib/analysis/account-data.js'
import {
  computeRiskFlags,
  fetchLatestBranchSet,
  persistRiskFlags,
} from '../../../_lib/analysis/risk-flags.js'

export const config = { maxDuration: 300 }

const CONCURRENCY = 10

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const accountId = req.query.accountId as string
  const body = (req.body ?? {}) as { client_id?: string | null }
  const db = createAdminClient()

  try {
    const properties = await loadAccountProperties(db, accountId, body.client_id ?? null)

    const branchSet = await fetchLatestBranchSet(db, accountId)
    const branches = branchSet?.map((b) => ({ lat: b.lat, lng: b.lng }))
    const portfolioPoints = properties
      .filter((p) => p.latitude != null && p.longitude != null)
      .map((p) => ({ id: p.id, lat: p.latitude!, lng: p.longitude! }))

    let succeeded = 0
    let failed = 0

    for (let i = 0; i < properties.length; i += CONCURRENCY) {
      const chunk = properties.slice(i, i + CONCURRENCY)
      const settled = await Promise.allSettled(
        chunk.map(async (p) => {
          const { flags, score } = computeRiskFlags(
            {
              id: p.id,
              latitude: p.latitude,
              longitude: p.longitude,
              geocode_confidence: p.geocode_confidence,
              address_validation_verdict: p.address_validation_verdict,
              service_locations: p.service_locations.map((sl) => ({
                serviceable_sqft: sl.serviceable_sqft,
                service_offering_id: sl.service_offering_id,
              })),
            },
            { branches, portfolio_points: portfolioPoints }
          )
          await persistRiskFlags(db, p.id, flags, score)
        })
      )
      for (const r of settled) {
        if (r.status === 'fulfilled') succeeded += 1
        else failed += 1
      }
    }

    return res.status(200).json({
      status: 'completed',
      total: properties.length,
      succeeded,
      failed,
    })
  } catch (err: any) {
    const msg = err?.message ?? String(err)
    return res.status(500).json({ status: 'failed', error: msg })
  }
}
