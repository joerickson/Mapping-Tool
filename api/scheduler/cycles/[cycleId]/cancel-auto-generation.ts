// POST /api/scheduler/cycles/[cycleId]/cancel-auto-generation
//
// Phase 4e — undo a prior auto-generation: marks the linked next cycle
// as 'cancelled', clears the parent cycle's next_cycle_id, and lets a
// future trigger attempt run again.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const cycleId = req.query.cycleId as string
  if (!cycleId) return res.status(400).json({ error: 'cycleId required' })
  const db = createAdminClient()

  const { data: cycle } = await db
    .from('cycle_instances')
    .select('id, next_cycle_id')
    .eq('id', cycleId)
    .single()
  if (!cycle) return res.status(404).json({ error: 'Cycle not found' })
  const nextId = (cycle as any).next_cycle_id as string | null
  if (!nextId) return res.status(200).json({ cancelled: false, reason: 'no_next_cycle' })

  await db
    .from('cycle_instances')
    .update({ status: 'cancelled' })
    .eq('id', nextId)
  await db
    .from('cycle_instances')
    .update({ next_cycle_id: null, auto_generation_triggered_at: null })
    .eq('id', cycleId)

  return res.status(200).json({ cancelled: true, cancelled_cycle_id: nextId })
}
