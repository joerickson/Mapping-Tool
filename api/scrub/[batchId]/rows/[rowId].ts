import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase'
import { verifyAuth, unauthorized } from '../../../_lib/auth'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await verifyAuth(req)
  if (!auth.ok) return unauthorized(res, auth.error)

  const rowId = req.query.rowId as string
  if (!rowId) return res.status(400).json({ error: 'rowId required' })

  const { user_action, user_edited_address } = req.body ?? {}
  const validActions = ['approved', 'skip', 'merge', 'treat_as_new']
  if (user_action && !validActions.includes(user_action)) {
    return res.status(400).json({ error: `user_action must be one of: ${validActions.join(', ')}` })
  }

  const db = createAdminClient()

  const updates: Record<string, unknown> = {}
  if (user_action) updates.user_action = user_action
  if (user_edited_address !== undefined) {
    updates.user_edited_address = user_edited_address
    // If user edited the address, upgrade status to auto_corrected (it was needs_review)
    updates.scrub_status = 'auto_corrected'
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Nothing to update' })
  }

  const { error } = await db
    .from('staged_addresses')
    .update(updates)
    .eq('staged_id', rowId)

  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ ok: true })
}
