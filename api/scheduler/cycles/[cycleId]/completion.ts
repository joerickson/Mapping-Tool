// GET  /api/scheduler/cycles/[cycleId]/completion         — current stats (cheap)
// POST /api/scheduler/cycles/[cycleId]/completion         — recalculate + persist
//
// Phase 4e completion tracker: counts completed/cancelled/placed/unplaced
// visits, computes completion_pct, persists on cycle_instances, and
// auto-transitions cycle.status (planned → in_progress on first
// completion; in_progress → completed at 100%).
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import {
  calculateCycleCompletion,
  refreshCycleCompletion,
} from '../../../_lib/scheduler/cycle-completion.js'

export const config = { maxDuration: 30 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const cycleId = req.query.cycleId as string
  if (!cycleId) return res.status(400).json({ error: 'cycleId required' })
  const db = createAdminClient()

  try {
    if (req.method === 'GET') {
      const stats = await calculateCycleCompletion(db, cycleId)
      return res.status(200).json(stats)
    }
    if (req.method === 'POST') {
      const result = await refreshCycleCompletion(db, cycleId)
      return res.status(200).json({ ...result.stats, status_changed_to: result.status_changed_to })
    }
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? String(err) })
  }
}
