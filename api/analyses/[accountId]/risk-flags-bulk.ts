// POST /api/analyses/[accountId]/risk-flags-bulk
// Bulk-assess risk flags for every property tied to this account. Returns
// counts of properties processed and a histogram of flag types. Concurrency
// is bounded; the work is fire-and-forget so the dashboard can poll.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'
import { loadAccountProperties } from '../../_lib/analysis/account-data.js'
import {
  computeRiskFlags,
  fetchLatestBranchSet,
  persistRiskFlags,
} from '../../_lib/analysis/risk-flags.js'

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

  // Risk-flag bulk runs aren't a "real" portfolio_analyses module per the schema
  // CHECK constraint, so we don't write a portfolio_analyses row. Track via the
  // properties table directly.
  // We DO want async + polling though, so respond 202 first and run in background.
  // For polling, the client can hit GET /api/v1/properties to watch risk_assessed_at.
  res.status(202).json({ status: 'running' })

  ;(async () => {
    try {
      const properties = await loadAccountProperties(db, accountId, body.client_id ?? null)

      const branchSet = await fetchLatestBranchSet(db, accountId)
      const branches = branchSet?.map((b) => ({ lat: b.lat, lng: b.lng }))
      const portfolioPoints = properties
        .filter((p) => p.latitude != null && p.longitude != null)
        .map((p) => ({ id: p.id, lat: p.latitude!, lng: p.longitude! }))

      // Process in concurrency-bounded batches
      for (let i = 0; i < properties.length; i += CONCURRENCY) {
        const chunk = properties.slice(i, i + CONCURRENCY)
        await Promise.allSettled(
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
      }
    } catch (err: any) {
      // Best-effort: log and move on. There's no portfolio_analyses row to mark failed.
      console.error('risk-flags-bulk failed:', err)
    }
  })()
}
