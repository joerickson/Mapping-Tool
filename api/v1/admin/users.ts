// GET /api/v1/admin/users
//   → { users: AppUserRecord[], pending_invites: PendingInvite[], admin_count: number }
//
// Admin-gated. Returns the active user roster + still-pending invites.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { requireAdmin, adminCount } from '../../_lib/auth-roles.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await requireAdmin(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const db = createAdminClient()

  const { data: users, error: uErr } = await db
    .from('app_users')
    .select('id, email, name, role, is_active, created_at, last_seen_at')
    .order('created_at', { ascending: true })
  if (uErr) return res.status(500).json({ error: uErr.message })

  const { data: invites, error: iErr } = await db
    .from('user_invites')
    .select(
      'id, email, role, invited_by_email, expires_at, created_at, accepted_at, revoked_at'
    )
    .is('accepted_at', null)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
  if (iErr) return res.status(500).json({ error: iErr.message })

  return res.status(200).json({
    users: users ?? [],
    pending_invites: invites ?? [],
    admin_count: await adminCount(),
  })
}
