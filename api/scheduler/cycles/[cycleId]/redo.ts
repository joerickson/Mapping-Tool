// POST /api/scheduler/cycles/[cycleId]/redo
// Reapplies the most recently undone edit.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import { applyForward, type EditType } from '../../../_lib/scheduler/edit-history.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try { await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const cycleId = req.query.cycleId as string
  const db = createAdminClient()

  const { data: undone } = await db
    .from('cycle_edit_history')
    .select('id, edit_type, forward_payload, edit_index, description')
    .eq('cycle_instance_id', cycleId)
    .eq('is_active', false)
    .order('undone_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!undone) return res.status(400).json({ error: 'Nothing to redo' })
  const row = undone as any
  try {
    await applyForward(db, row.edit_type as EditType, row.forward_payload as Record<string, unknown>)
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'Redo failed' })
  }
  await db
    .from('cycle_edit_history')
    .update({ is_active: true, undone_at: null })
    .eq('id', row.id)
  return res.status(200).json({
    redone: { id: row.id, edit_index: row.edit_index, description: row.description },
  })
}
