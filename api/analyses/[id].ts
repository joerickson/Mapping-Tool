// GET /api/analyses/[id] — fetch a single analysis row.
// Used by the dashboard to poll for status: 'pending' | 'running' | 'completed' | 'failed'.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../_lib/supabase.js'
import { authenticateRequest } from '../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const id = req.query.id as string
  const db = createAdminClient()

  const { data, error } = await db
    .from('portfolio_analyses')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) return res.status(404).json({ error: 'Analysis not found' })
  return res.status(200).json(data)
}
