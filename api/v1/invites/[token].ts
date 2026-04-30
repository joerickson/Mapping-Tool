// GET  /api/v1/invites/[token] — public lookup; returns invite metadata
//   so the accept page can render context before the user signs up.
//   Does NOT require auth.
// POST /api/v1/invites/[token] — accept the invite. Requires the user
//   to be authenticated (Supabase Auth) AND their email must match
//   the invite's email. Creates/updates app_users with the invite's
//   role and stamps the invite as accepted.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  const token = req.query.token as string
  if (!token) return res.status(400).json({ error: 'token required' })
  const db = createAdminClient()

  if (req.method === 'GET') {
    const { data: invite } = await db
      .from('user_invites')
      .select('email, role, expires_at, accepted_at, revoked_at, invited_by_email')
      .eq('token', token)
      .maybeSingle()
    if (!invite) return res.status(404).json({ error: 'Invite not found' })
    const i = invite as any
    const status =
      i.revoked_at != null
        ? 'revoked'
        : i.accepted_at != null
          ? 'accepted'
          : new Date(i.expires_at) < new Date()
            ? 'expired'
            : 'pending'
    return res.status(200).json({
      email: i.email,
      role: i.role,
      invited_by_email: i.invited_by_email,
      expires_at: i.expires_at,
      status,
    })
  }

  if (req.method === 'POST') {
    let ctx
    try {
      ctx = await authenticateRequest(req)
    } catch (err: any) {
      return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
    }
    if (ctx.mode !== 'user' || !ctx.userId || !ctx.email) {
      return res.status(403).json({ error: 'User session required to accept invite' })
    }

    const { data: invite } = await db
      .from('user_invites')
      .select('id, email, role, expires_at, accepted_at, revoked_at')
      .eq('token', token)
      .maybeSingle()
    if (!invite) return res.status(404).json({ error: 'Invite not found' })
    const i = invite as any
    if (i.revoked_at) return res.status(400).json({ error: 'Invite was revoked' })
    if (i.accepted_at) return res.status(400).json({ error: 'Invite already accepted' })
    if (new Date(i.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Invite expired; ask the inviter for a new link' })
    }
    if (i.email.toLowerCase() !== (ctx.email ?? '').toLowerCase()) {
      return res.status(403).json({
        error: `This invite is for ${i.email}; you're signed in as ${ctx.email}`,
      })
    }

    const now = new Date().toISOString()
    // Upsert app_users with the invite's role.
    const { error: uErr } = await db
      .from('app_users')
      .upsert(
        {
          id: ctx.userId,
          email: ctx.email,
          role: i.role,
          is_active: true,
          last_seen_at: now,
          updated_at: now,
        },
        { onConflict: 'id' }
      )
    if (uErr) return res.status(500).json({ error: uErr.message })

    await db
      .from('user_invites')
      .update({ accepted_at: now, accepted_by_user_id: ctx.userId })
      .eq('id', i.id)

    return res.status(200).json({
      accepted: true,
      role: i.role,
    })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
