// POST /api/scheduler/visits/[visitId]/lock
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import { lockVisit } from '../../../_lib/scheduler/edit-propagation.js'
import { recordEdit } from '../../../_lib/scheduler/edit-history.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  let ctx
  try { ctx = await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const visitId = req.query.visitId as string
  const db = createAdminClient()
  const { data: before } = await db
    .from('scheduled_visits')
    .select('cycle_instance_id, is_locked, locked_by, service_locations(display_name)')
    .eq('id', visitId)
    .single()
  const beforeRow = before as any

  await lockVisit(db, visitId, ctx.email ?? ctx.userId ?? null)

  if (beforeRow?.cycle_instance_id) {
    const addr = beforeRow.service_locations?.display_name ?? visitId.slice(0, 8)
    try {
      await recordEdit(db, {
        cycle_instance_id: beforeRow.cycle_instance_id,
        edit_type: 'lock_visit',
        forward_payload: { visit_id: visitId, is_locked: true, locked_by: ctx.email ?? ctx.userId ?? null },
        reverse_payload: { visit_id: visitId, is_locked: !!beforeRow.is_locked, locked_by: beforeRow.locked_by },
        description: `Locked "${addr}"`,
        edited_by: ctx.email ?? ctx.userId ?? null,
      })
    } catch (err) {
      console.error('[lock-visit] history record failed:', err)
    }
  }
  return res.status(200).json({ ok: true })
}
