// Role-based gates layered on top of authenticateRequest. Treats the
// app_users table as the source of truth for role + active flag.
import type { VercelRequest } from '@vercel/node'
import { authenticateRequest, type AuthContext } from './auth.js'
import { createAdminClient } from './supabase.js'

export interface AppUserRecord {
  id: string
  email: string
  name: string | null
  role: 'admin' | 'member'
  is_active: boolean
}

export async function getAppUser(
  userId: string
): Promise<AppUserRecord | null> {
  const db = createAdminClient()
  const { data } = await db
    .from('app_users')
    .select('id, email, name, role, is_active')
    .eq('id', userId)
    .maybeSingle()
  return (data as AppUserRecord | null) ?? null
}

// Counts admins so the bootstrap path can detect "no admin yet".
export async function adminCount(): Promise<number> {
  const db = createAdminClient()
  const { count } = await db
    .from('app_users')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'admin')
    .eq('is_active', true)
  return count ?? 0
}

// Authenticates AND requires the user to be an active admin. Throws
// {statusCode, message} on failure (matches the existing pattern in
// authenticateRequest).
export async function requireAdmin(req: VercelRequest): Promise<{
  ctx: AuthContext
  user: AppUserRecord
}> {
  const ctx = await authenticateRequest(req)
  if (ctx.mode !== 'user' || !ctx.userId) {
    throw { statusCode: 403, message: 'Admin access requires a user session' }
  }
  const record = await getAppUser(ctx.userId)
  if (!record) {
    throw { statusCode: 403, message: 'No app user record — accept an invite first' }
  }
  if (!record.is_active) {
    throw { statusCode: 403, message: 'Your account is deactivated' }
  }
  if (record.role !== 'admin') {
    throw { statusCode: 403, message: 'Admin role required' }
  }
  return { ctx, user: record }
}
