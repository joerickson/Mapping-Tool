// GET /api/v1/me
//   → { user_id, email, app_user, admin_count, can_bootstrap }
//
// Lightweight self-introspection so the frontend can route admin pages
// and show/hide the bootstrap-first-admin button.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authenticateRequest } from '../_lib/auth.js'
import { adminCount, getAppUser } from '../_lib/auth-roles.js'
import { createAdminClient } from '../_lib/supabase.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  let ctx
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  if (ctx.mode !== 'user' || !ctx.userId) {
    return res.status(200).json({ mode: ctx.mode })
  }
  const appUser = await getAppUser(ctx.userId)
  // Stamp last_seen_at when the row exists. Cheap heartbeat for the
  // admin user list.
  if (appUser) {
    const db = createAdminClient()
    await db
      .from('app_users')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', ctx.userId)
  }
  const ct = await adminCount()
  return res.status(200).json({
    mode: ctx.mode,
    user_id: ctx.userId,
    email: ctx.email,
    app_user: appUser,
    admin_count: ct,
    can_bootstrap: ct === 0,
  })
}
