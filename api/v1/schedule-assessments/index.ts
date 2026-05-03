// GET  /api/v1/schedule-assessments?client_id=...
//   List assessments for a client.
// POST /api/v1/schedule-assessments
//   Create a new assessment. Body: { account_id, client_id, name,
//   baseline_template_id? }.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest, type AuthContext } from '../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  let ctx: AuthContext
  try { ctx = await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const db = createAdminClient()

  if (req.method === 'GET') {
    const clientId = req.query.client_id as string | undefined
    if (!clientId) return res.status(400).json({ error: 'client_id required' })
    const { data, error } = await db
      .from('schedule_assessments')
      .select('id, name, status, baseline_template_id, created_at, updated_at')
      .eq('client_id', clientId)
      .neq('status', 'archived')
      .order('updated_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ assessments: data ?? [] })
  }

  if (req.method === 'POST') {
    const body = (req.body ?? {}) as {
      account_id?: string
      client_id?: string
      name?: string
      baseline_template_id?: string | null
    }
    const accountId = body.account_id
    const clientId = body.client_id
    const name = (body.name ?? '').trim()
    if (!accountId || !clientId || !name) {
      return res.status(400).json({ error: 'account_id, client_id, and name required' })
    }
    const { data, error } = await db
      .from('schedule_assessments')
      .insert({
        account_id: accountId,
        client_id: clientId,
        name,
        baseline_template_id: body.baseline_template_id ?? null,
        status: 'draft',
        created_by: ctx.userId ?? null,
      })
      .select('*')
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(201).json({ assessment: data })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
