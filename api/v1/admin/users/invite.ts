// POST /api/v1/admin/users/invite
// Body: { email: string, role?: 'admin' | 'member' }
//
// Admin-gated. Creates a user_invites row, sends a Resend invite
// email when configured, and returns the invite plus a "link" the
// admin can copy/paste manually if email isn't set up yet.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'
import { createAdminClient } from '../../../_lib/supabase.js'
import { requireAdmin } from '../../../_lib/auth-roles.js'
import { sendInviteEmail } from '../../../_lib/email/send-invite.js'

const INVITE_EXPIRY_DAYS = 14

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let auth
  try {
    auth = await requireAdmin(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const body = (req.body ?? {}) as Record<string, unknown>
  const email =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const role = body.role === 'admin' ? 'admin' : 'member'
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required' })
  }

  const db = createAdminClient()

  // Don't double-invite an existing active user.
  const { data: existing } = await db
    .from('app_users')
    .select('id, is_active')
    .eq('email', email)
    .maybeSingle()
  if (existing && (existing as any).is_active) {
    return res.status(409).json({ error: 'A user with that email already exists' })
  }

  // Revoke any prior pending invites for this email — we want exactly
  // one valid token in flight at a time.
  await db
    .from('user_invites')
    .update({ revoked_at: new Date().toISOString(), revoked_by: auth.user.id })
    .eq('email', email)
    .is('accepted_at', null)
    .is('revoked_at', null)

  const token = crypto.randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 86400_000)

  const { data: invite, error: insertErr } = await db
    .from('user_invites')
    .insert({
      email,
      role,
      token,
      invited_by: auth.user.id,
      invited_by_email: auth.user.email,
      expires_at: expiresAt.toISOString(),
    })
    .select('id, email, role, expires_at, created_at')
    .single()
  if (insertErr) return res.status(500).json({ error: insertErr.message })

  const sendResult = await sendInviteEmail({
    toEmail: email,
    inviteToken: token,
    invitedByEmail: auth.user.email,
    role,
    expiresAt,
  })

  return res.status(200).json({
    invite,
    link: sendResult.link,
    email: {
      sent: sendResult.sent,
      message_id: sendResult.message_id ?? null,
      error: sendResult.error ?? null,
    },
  })
}
