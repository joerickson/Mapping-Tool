import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const { id } = req.query
  const db = createAdminClient()

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('portfolios')
      .select('*')
      .eq('portfolio_id', id)
      .single()

    if (error || !data) return res.status(404).json({ error: 'Not found' })
    return res.status(200).json(data)
  }

  if (req.method === 'PATCH') {
    const { data, error } = await db
      .from('portfolios')
      .update({ ...req.body, updated_at: new Date().toISOString() })
      .eq('portfolio_id', id)
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
