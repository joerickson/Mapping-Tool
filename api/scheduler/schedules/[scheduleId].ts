// GET    /api/scheduler/schedules/[scheduleId] — full detail
// PATCH  /api/scheduler/schedules/[scheduleId] — update name/description/status
// DELETE /api/scheduler/schedules/[scheduleId] — soft delete (status=cancelled),
//        or hard delete with ?hard=true
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'

export const config = { maxDuration: 10 }

const ALLOWED_STATUS_TRANSITIONS = ['draft', 'committed', 'cancelled']

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const scheduleId = req.query.scheduleId as string
  if (!scheduleId) return res.status(400).json({ error: 'scheduleId required' })

  const db = createAdminClient()

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('day_schedules')
      .select('*')
      .eq('id', scheduleId)
      .maybeSingle()
    if (error) return res.status(500).json({ error: error.message })
    if (!data) return res.status(404).json({ error: 'Schedule not found' })
    return res.status(200).json({ schedule: data })
  }

  if (req.method === 'PATCH') {
    const body = (req.body ?? {}) as Record<string, unknown>
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof body.name === 'string') update.name = body.name.trim() || null
    if (body.description !== undefined) {
      update.description =
        typeof body.description === 'string' && body.description.trim().length > 0
          ? body.description.trim()
          : null
    }
    if (typeof body.status === 'string') {
      if (!ALLOWED_STATUS_TRANSITIONS.includes(body.status)) {
        return res.status(400).json({
          error: `status must be one of: ${ALLOWED_STATUS_TRANSITIONS.join(', ')}`,
        })
      }
      update.status = body.status
    }

    const { data, error } = await db
      .from('day_schedules')
      .update(update)
      .eq('id', scheduleId)
      .select('*')
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ schedule: data })
  }

  if (req.method === 'DELETE') {
    const hard = String(req.query.hard ?? '').toLowerCase() === 'true'
    if (hard) {
      const { error } = await db.from('day_schedules').delete().eq('id', scheduleId)
      if (error) return res.status(500).json({ error: error.message })
      return res.status(204).end()
    }
    const { error } = await db
      .from('day_schedules')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', scheduleId)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(204).end()
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
