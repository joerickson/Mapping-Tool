// GET /api/v1/properties/[id]/edit-history
// Full edit log for a property — both property-level edits and SL-level
// edits show up here, ordered newest first.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const { id } = req.query
  const db = createAdminClient()

  const { data, error } = await db
    .from('property_edit_history')
    .select('*')
    .eq('property_id', id)
    .order('changed_at', { ascending: false })
    .limit(100)

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ history: data ?? [] })
}
