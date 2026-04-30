// PATCH /api/v1/admin/users/[id]
// Body: { role?: 'admin' | 'member', is_active?: boolean, name?: string }
//
// Admin-gated. Update role / activation / display name. Won't allow
// the calling admin to demote/deactivate themselves (avoids accidental
// lockout) or remove the last admin.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { requireAdmin, adminCount } from '../../../_lib/auth-roles.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' })

  let auth
  try {
    auth = await requireAdmin(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const targetId = req.query.id as string
  if (!targetId) return res.status(400).json({ error: 'user id required' })

  const body = (req.body ?? {}) as Record<string, unknown>
  const updates: Record<string, unknown> = {}
  if (body.role === 'admin' || body.role === 'member') updates.role = body.role
  if (typeof body.is_active === 'boolean') updates.is_active = body.is_active
  if (typeof body.name === 'string') updates.name = body.name.trim() || null
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No editable fields in body' })
  }

  const db = createAdminClient()
  const { data: target } = await db
    .from('app_users')
    .select('id, role, is_active')
    .eq('id', targetId)
    .single()
  if (!target) return res.status(404).json({ error: 'User not found' })
  const t = target as any

  // Self-demote / self-deactivate guards.
  if (targetId === auth.user.id) {
    if (updates.role && updates.role !== 'admin') {
      return res.status(400).json({ error: "Can't demote yourself; ask another admin to do it." })
    }
    if (updates.is_active === false) {
      return res.status(400).json({ error: "Can't deactivate yourself." })
    }
  }

  // Last-admin protection.
  const wasAdmin = t.role === 'admin' && t.is_active
  const stillAdmin =
    (updates.role !== undefined ? updates.role === 'admin' : t.role === 'admin') &&
    (updates.is_active !== undefined ? updates.is_active === true : t.is_active === true)
  if (wasAdmin && !stillAdmin) {
    const adminCt = await adminCount()
    if (adminCt <= 1) {
      return res.status(400).json({
        error: 'Cannot remove the last admin. Promote another user first.',
      })
    }
  }

  updates.updated_at = new Date().toISOString()
  const { data: updated, error } = await db
    .from('app_users')
    .update(updates)
    .eq('id', targetId)
    .select('id, email, name, role, is_active')
    .single()
  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ user: updated })
}
