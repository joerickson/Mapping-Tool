// GET / PATCH / DELETE /api/scheduler/cycles/[cycleId]
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try { await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const id = req.query.cycleId as string
  const db = createAdminClient()

  if (req.method === 'GET') {
    const { data: cycle } = await db.from('cycle_instances').select('*').eq('id', id).maybeSingle()
    if (!cycle) return res.status(404).json({ error: 'Cycle not found' })
    const { data: visits } = await db
      .from('scheduled_visits')
      .select('*, service_locations(id, display_name, property:properties(id, address_line1))')
      .eq('cycle_instance_id', id)
      .order('scheduled_date', { ascending: true })
    const { data: crewDays } = await db
      .from('crew_day_routes')
      .select('*')
      .eq('cycle_instance_id', id)
      .order('scheduled_date', { ascending: true })
      .order('crew_index', { ascending: true })
    return res.status(200).json({ cycle, visits: visits ?? [], crew_days: crewDays ?? [] })
  }
  if (req.method === 'PATCH') {
    const body = (req.body ?? {}) as Record<string, unknown>
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof body.status === 'string') update.status = body.status
    const { data, error } = await db.from('cycle_instances').update(update).eq('id', id).select('*').single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ cycle: data })
  }
  if (req.method === 'DELETE') {
    const hard = String(req.query.hard ?? '').toLowerCase() === 'true'
    if (hard) {
      const { error } = await db.from('cycle_instances').delete().eq('id', id)
      if (error) return res.status(500).json({ error: error.message })
      return res.status(204).end()
    }
    const { error } = await db.from('cycle_instances').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(204).end()
  }
  return res.status(405).json({ error: 'Method not allowed' })
}
