// GET / PATCH / DELETE /api/scheduler/templates/[templateId]
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try { await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const id = req.query.templateId as string
  const db = createAdminClient()

  if (req.method === 'GET') {
    const { data, error } = await db.from('routing_templates').select('*').eq('id', id).maybeSingle()
    if (error) return res.status(500).json({ error: error.message })
    if (!data) return res.status(404).json({ error: 'Template not found' })
    return res.status(200).json({ template: data })
  }
  if (req.method === 'PATCH') {
    const body = (req.body ?? {}) as Record<string, unknown>
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof body.name === 'string') update.name = body.name
    if (body.description !== undefined) update.description = body.description
    if (typeof body.status === 'string') update.status = body.status
    if (typeof body.planning_mode === 'string') update.planning_mode = body.planning_mode
    const { data, error } = await db.from('routing_templates').update(update).eq('id', id).select('*').single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ template: data })
  }
  if (req.method === 'DELETE') {
    const hard = String(req.query.hard ?? '').toLowerCase() === 'true'
    if (hard) {
      const { error } = await db.from('routing_templates').delete().eq('id', id)
      if (error) return res.status(500).json({ error: error.message })
      return res.status(204).end()
    }
    const { error } = await db.from('routing_templates').update({ status: 'archived', updated_at: new Date().toISOString() }).eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(204).end()
  }
  return res.status(405).json({ error: 'Method not allowed' })
}
