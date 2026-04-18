import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase'
import { verifyAuth, unauthorized } from '../../_lib/auth'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await verifyAuth(req)
  if (!auth.ok) return unauthorized(res, auth.error)

  const db = createAdminClient()
  const { data, error } = await db.from('rbm_categories').select('*').order('label')
  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json(data ?? [])
}
