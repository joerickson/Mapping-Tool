// /api/accounts/[accountId]/scenarios/[scenarioId]
//   GET    — fetch a single saved scenario (includes module_results)
//   DELETE — soft-delete (sets is_active=false)
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../../../_lib/supabase.js'
import { authenticateRequest } from '../../../../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const accountId = req.query.accountId as string
  const clientId = req.query.clientId as string
  const scenarioId = req.query.scenarioId as string
  const db = createAdminClient()

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('analysis_scenarios')
      .select('*')
      .eq('id', scenarioId)
      .eq('account_id', accountId)
      .eq('client_id', clientId)
      .single()
    if (error || !data) return res.status(404).json({ error: 'Scenario not found' })
    return res.status(200).json(data)
  }

  if (req.method === 'DELETE') {
    const { error } = await db
      .from('analysis_scenarios')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', scenarioId)
      .eq('account_id', accountId)
      .eq('client_id', clientId)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
