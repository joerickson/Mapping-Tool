import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../../_lib/supabase.js'
import { authenticateRequest } from '../../../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let ctx: Awaited<ReturnType<typeof authenticateRequest>>
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  if (ctx.mode !== 'user') {
    return res.status(403).json({ error: 'Admin endpoints require user authentication' })
  }

  const db = createAdminClient()
  const { id } = req.query

  const { data, error } = await db
    .from('service_api_keys')
    .update({ is_active: false, revoked_at: new Date().toISOString() })
    .eq('key_id', String(id))
    .select('key_id, consumer_name, revoked_at')
    .single()

  if (error || !data) return res.status(404).json({ error: 'Key not found' })

  return res.status(200).json({ revoked: true, ...data })
}
