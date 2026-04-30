// POST /api/scheduler/cycles/[cycleId]/undo
// Reverses the most recent active edit.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import { applyReverse, type EditType } from '../../../_lib/scheduler/edit-history.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try { await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const cycleId = req.query.cycleId as string
  const db = createAdminClient()

  const { data: latest } = await db
    .from('cycle_edit_history')
    .select('id, edit_type, reverse_payload, edit_index, description')
    .eq('cycle_instance_id', cycleId)
    .eq('is_active', true)
    .order('edit_index', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!latest) return res.status(400).json({ error: 'Nothing to undo' })
  const row = latest as any
  try {
    await applyReverse(db, row.edit_type as EditType, row.reverse_payload as Record<string, unknown>)
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'Undo failed' })
  }
  await db
    .from('cycle_edit_history')
    .update({ is_active: false, undone_at: new Date().toISOString() })
    .eq('id', row.id)
  return res.status(200).json({
    undone: { id: row.id, edit_index: row.edit_index, description: row.description },
  })
}
