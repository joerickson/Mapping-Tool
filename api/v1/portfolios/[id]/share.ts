import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const { id } = req.query
  const db = createAdminClient()

  const shareToken = crypto.randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString() // 90 days

  const { data, error } = await db
    .from('portfolios')
    .update({ share_token: shareToken, share_expires_at: expiresAt })
    .eq('portfolio_id', id)
    .select('share_token, share_expires_at')
    .single()

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json(data)
}
