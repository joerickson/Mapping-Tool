import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'
import { createAdminClient } from '../../../_lib/supabase.js'
import { requireAdmin } from '../../../_lib/auth-roles.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Mints/revokes a public link — admin only, enforced server-side.
  try {
    await requireAdmin(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 403).json({ error: err.message ?? 'Forbidden' })
  }

  const id = req.query.id as string
  if (!id) return res.status(400).json({ error: 'client id is required' })

  const body = (req.body ?? {}) as Record<string, unknown>
  const db = createAdminClient()

  if (req.method === 'DELETE' || body.revoke === true) {
    const { error } = await db
      .from('clients')
      .update({ share_token: null, share_expires_at: null })
      .eq('id', id)
      .select('share_token')
      .single()
    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'client_not_found' })
      return res.status(500).json({ error: error.message })
    }
    return res.status(200).json({ share_token: null })
  }

  let expiresAt: string | null = null
  if (body.expires_at !== undefined && body.expires_at !== null) {
    const d = typeof body.expires_at === 'string' ? new Date(body.expires_at) : null
    if (!d || Number.isNaN(d.getTime())) {
      return res.status(400).json({ error: 'expires_at must be a valid ISO date string' })
    }
    if (d.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'expires_at must be in the future' })
    }
    expiresAt = d.toISOString()
  }

  const shareToken = crypto.randomBytes(24).toString('base64url')

  const { data, error } = await db
    .from('clients')
    .update({ share_token: shareToken, share_expires_at: expiresAt })
    .eq('id', id)
    .select('share_token, share_expires_at')
    .single()

  if (error) {
    if (error.code === 'PGRST116') return res.status(404).json({ error: 'client_not_found' })
    return res.status(500).json({ error: error.message })
  }
  return res.status(200).json(data)
}
