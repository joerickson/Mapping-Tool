// POST /api/v1/admin/users/bootstrap
//
// One-shot endpoint to promote the calling user to admin when no
// active admin exists yet. Auth-required (must be a real signed-in
// user). After running once, this endpoint is a no-op.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import { adminCount } from '../../../_lib/auth-roles.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let ctx
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  if (ctx.mode !== 'user' || !ctx.userId) {
    return res.status(403).json({ error: 'User session required' })
  }

  if ((await adminCount()) > 0) {
    return res.status(409).json({ error: 'An admin already exists; ask them to invite you' })
  }

  const db = createAdminClient()
  const now = new Date().toISOString()
  // Upsert by id so a pre-existing app_users row (e.g. created via a
  // prior invite path) is promoted instead of double-inserted.
  const { data, error } = await db
    .from('app_users')
    .upsert(
      {
        id: ctx.userId,
        email: ctx.email ?? '',
        role: 'admin',
        is_active: true,
        last_seen_at: now,
        updated_at: now,
      },
      { onConflict: 'id' }
    )
    .select('id, email, role, is_active')
    .single()
  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ user: data })
}
