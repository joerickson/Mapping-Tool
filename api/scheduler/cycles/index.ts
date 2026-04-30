// GET /api/scheduler/cycles?template_id=&status=
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try { await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const templateId = req.query.template_id as string | undefined
  if (!templateId) return res.status(400).json({ error: 'template_id required' })
  const db = createAdminClient()
  let q = db
    .from('cycle_instances')
    .select('*')
    .eq('template_id', templateId)
    .order('cycle_number', { ascending: false })
  const status = req.query.status as string | undefined
  if (status) q = q.in('status', String(status).split(','))
  const { data, error } = await q.limit(50)
  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ cycles: data ?? [] })
}
