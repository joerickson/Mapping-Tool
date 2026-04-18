import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'
import { createAdminClient } from '../../../_lib/supabase'
import { authenticateRequest } from '../../../_lib/auth'

function hashKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  let ctx: Awaited<ReturnType<typeof authenticateRequest>>
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  // Admin-only: require user context (not service)
  if (ctx.mode !== 'user') {
    return res.status(403).json({ error: 'Admin endpoints require user authentication' })
  }

  const db = createAdminClient()

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('service_api_keys')
      .select('key_id, consumer_name, key_prefix, is_active, created_by, created_at, last_used_at, revoked_at')
      .order('created_at', { ascending: false })

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data ?? [])
  }

  if (req.method === 'POST') {
    const { consumer_name } = req.body ?? {}
    if (!consumer_name) return res.status(400).json({ error: 'consumer_name required' })

    const rawKey = 'rbm_sk_live_' + crypto.randomBytes(32).toString('base64url')
    const keyPrefix = rawKey.slice(0, 20) + '...'
    const keyHash = hashKey(rawKey)

    const { data, error } = await db
      .from('service_api_keys')
      .insert({
        consumer_name,
        key_prefix: keyPrefix,
        key_hash: keyHash,
        is_active: true,
        created_by: ctx.userId,
      })
      .select('key_id, consumer_name, key_prefix, created_at')
      .single()

    if (error) return res.status(500).json({ error: error.message })

    // Return the raw key ONCE — never stored plaintext
    return res.status(201).json({ ...data, key: rawKey })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
