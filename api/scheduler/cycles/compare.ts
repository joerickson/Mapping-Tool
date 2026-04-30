// GET /api/scheduler/cycles/compare?left=<cycleId>&right=<cycleId>
//
// Phase 4e — side-by-side cycle summary + delta computation.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'
import { compareCycles } from '../../_lib/scheduler/cycle-comparison.js'

export const config = { maxDuration: 30 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const left = req.query.left as string | undefined
  const right = req.query.right as string | undefined
  if (!left || !right) {
    return res.status(400).json({ error: 'left and right cycle ids required' })
  }
  if (left === right) {
    return res.status(400).json({ error: 'left and right must be different cycles' })
  }
  const db = createAdminClient()
  try {
    const result = await compareCycles(db, left, right)
    return res.status(200).json(result)
  } catch (err: any) {
    return res.status(400).json({ error: err?.message ?? String(err) })
  }
}
