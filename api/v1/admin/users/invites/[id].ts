// DELETE /api/v1/admin/users/invites/[id]
//
// Admin-gated. Revoke a pending invite — sets revoked_at so the token
// stops working. Already-accepted invites can't be revoked.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../../_lib/supabase.js'
import { requireAdmin } from '../../../../_lib/auth-roles.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' })

  let auth
  try {
    auth = await requireAdmin(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const inviteId = req.query.id as string
  if (!inviteId) return res.status(400).json({ error: 'invite id required' })

  const db = createAdminClient()
  const { data: invite } = await db
    .from('user_invites')
    .select('id, accepted_at')
    .eq('id', inviteId)
    .single()
  if (!invite) return res.status(404).json({ error: 'Invite not found' })
  if ((invite as any).accepted_at) {
    return res.status(400).json({ error: 'Already accepted; cannot revoke' })
  }

  const { error } = await db
    .from('user_invites')
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: auth.user.id,
    })
    .eq('id', inviteId)
  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ revoked: true })
}
