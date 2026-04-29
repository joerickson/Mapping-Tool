// /api/analyses/[id]
//   GET   — fetch a single analysis row (used by the dashboard to poll
//           for status: 'pending' | 'running' | 'completed' | 'failed').
//   PATCH — currently only supports marking a stuck row as failed:
//           body { status: 'failed', error_message?: string }. Used by the
//           dashboard's "Mark as failed" button when a row sits in 'running'
//           past the stuck threshold (caused by old fire-and-forget work that
//           was killed before writing a terminal state).
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../_lib/supabase.js'
import { authenticateRequest } from '../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const id = req.query.id as string
  const db = createAdminClient()

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('portfolio_analyses')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !data) return res.status(404).json({ error: 'Analysis not found' })
    return res.status(200).json(data)
  }

  if (req.method === 'PATCH') {
    const body = (req.body ?? {}) as { status?: string; error_message?: string }
    if (body.status !== 'failed') {
      return res.status(400).json({ error: "Only { status: 'failed' } is supported" })
    }
    const { data, error } = await db
      .from('portfolio_analyses')
      .update({
        status: 'failed',
        error_message: (body.error_message ?? 'Marked failed by user').slice(0, 1000),
        completed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single()
    if (error || !data) return res.status(500).json({ error: error?.message ?? 'Update failed' })
    return res.status(200).json(data)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
