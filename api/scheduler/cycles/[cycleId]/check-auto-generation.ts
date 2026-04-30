// POST /api/scheduler/cycles/[cycleId]/check-auto-generation
// Body: { force?: boolean }
// Phase 4e — manually run the auto-generation check for this cycle.
// Returns the action taken (triggered, deferred, skipped, blocked).
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import { checkAndTriggerAutoGeneration } from '../../../_lib/scheduler/auto-generation.js'

export const config = { maxDuration: 300 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const cycleId = req.query.cycleId as string
  if (!cycleId) return res.status(400).json({ error: 'cycleId required' })
  const body = (req.body ?? {}) as Record<string, unknown>
  const db = createAdminClient()

  try {
    const outcome = await checkAndTriggerAutoGeneration(db, cycleId, {
      force: body.force === true,
    })
    return res.status(200).json(outcome)
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? String(err) })
  }
}
