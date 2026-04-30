// GET /api/scheduler/cycles/[cycleId]/crew-utilization
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import { computeCrewUtilization } from '../../../_lib/scheduler/crew-utilization.js'

export const config = { maxDuration: 30 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try { await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const cycleId = req.query.cycleId as string
  const includeWeekends = String(req.query.include_weekends ?? '').toLowerCase() === 'true'
  const db = createAdminClient()
  try {
    const days = await computeCrewUtilization(db, cycleId, { include_weekends: includeWeekends })
    return res.status(200).json({ days })
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? String(err) })
  }
}
