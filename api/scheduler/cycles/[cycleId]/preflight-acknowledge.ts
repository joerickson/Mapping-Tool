// POST /api/scheduler/cycles/[cycleId]/preflight-acknowledge
// Body: { issue_ids: uuid[] }       — acknowledge specific issues
//   or: { acknowledge_all_warnings: true }
//
// Phase 4e — operator acknowledges preflight issues so they drop to
// the collapsed "acknowledged" section in the UI.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  let ctx
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const cycleId = req.query.cycleId as string
  const body = (req.body ?? {}) as Record<string, unknown>
  const db = createAdminClient()
  const who = ctx.email ?? ctx.userId ?? null
  const stamp = new Date().toISOString()

  let q = db
    .from('cycle_preflight_checks')
    .update({ acknowledged: true, acknowledged_at: stamp, acknowledged_by: who })
    .eq('cycle_instance_id', cycleId)
    .eq('acknowledged', false)

  if (Array.isArray(body.issue_ids) && body.issue_ids.length > 0) {
    q = q.in('id', body.issue_ids as string[])
  } else if (body.acknowledge_all_warnings === true) {
    q = q.in('severity', ['warning', 'info'])
  } else {
    return res.status(400).json({ error: 'Provide issue_ids[] or acknowledge_all_warnings=true' })
  }

  const { data, error } = await q.select('id')
  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ acknowledged: (data ?? []).length })
}
