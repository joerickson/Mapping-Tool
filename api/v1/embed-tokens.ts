import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'
import { createAdminClient } from '../_lib/supabase'
import { authenticateRequest } from '../_lib/auth'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let ctx: Awaited<ReturnType<typeof authenticateRequest>>
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const { scope = {}, expires_in_hours = 24 } = req.body ?? {}

  const expiresAt = new Date(Date.now() + Number(expires_in_hours) * 3600 * 1000)
  const token = 'rbm_emb_' + crypto.randomBytes(24).toString('base64url')

  const db = createAdminClient()
  const { data, error } = await db
    .from('embed_tokens')
    .insert({
      token,
      scope,
      expires_at: expiresAt.toISOString(),
      created_by: ctx.userId ?? 'service',
    })
    .select('token_id')
    .single()

  if (error) return res.status(500).json({ error: error.message })

  return res.status(201).json({
    token,
    expires_at: expiresAt.toISOString(),
    token_id: data.token_id,
  })
}
