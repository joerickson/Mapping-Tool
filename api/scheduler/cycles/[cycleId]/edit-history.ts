// GET /api/scheduler/cycles/[cycleId]/edit-history
// Returns the last 50 edits (active + undone) for the history drawer.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try { await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const cycleId = req.query.cycleId as string
  const db = createAdminClient()
  const { data, error } = await db
    .from('cycle_edit_history')
    .select('id, edit_index, edit_type, description, edited_by, edited_at, is_active, undone_at, propagated_to_template')
    .eq('cycle_instance_id', cycleId)
    .order('edit_index', { ascending: false })
    .limit(50)
  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ edits: data ?? [] })
}
