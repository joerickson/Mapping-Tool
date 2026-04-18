import { createClerkClient } from '@clerk/backend'
import crypto from 'crypto'
import type { VercelRequest } from '@vercel/node'
import { createAdminClient } from './supabase'

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })

// Legacy return type kept for backward compat with upload.ts
export type AuthResult =
  | { ok: true; userId: string; type: 'clerk' | 'service' }
  | { ok: false; error: string }

export interface AuthContext {
  mode: 'user' | 'service'
  userId?: string
  orgId?: string
}

function hashKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

/**
 * Primary middleware for all v1 endpoints.
 * Returns AuthContext or throws an error object with statusCode 401.
 */
export async function authenticateRequest(req: VercelRequest): Promise<AuthContext> {
  const serviceKey = req.headers['x-rbm-service-key'] as string | undefined

  if (serviceKey) {
    const keyHash = hashKey(serviceKey)
    const db = createAdminClient()

    // DB-backed key lookup
    const { data: keyRecord } = await db
      .from('service_api_keys')
      .select('key_id, is_active')
      .eq('key_hash', keyHash)
      .maybeSingle()

    let keyId: string | null = null

    if (keyRecord && keyRecord.is_active) {
      keyId = keyRecord.key_id
    } else if (!keyRecord) {
      // Fallback: accept the single env-var key during migration period
      if (serviceKey !== process.env.SERVICE_API_KEY) {
        throw { statusCode: 401, message: 'Invalid service API key' }
      }
    } else {
      throw { statusCode: 401, message: 'Service API key has been revoked' }
    }

    // Log asynchronously (non-blocking)
    if (keyId) {
      const ip =
        (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
        (req.socket as any)?.remoteAddress ??
        null
      db.from('service_api_key_logs')
        .insert({ key_id: keyId, endpoint: req.url ?? '', ip })
        .then(() => {})
        .catch(() => {})

      db.from('service_api_keys')
        .update({ last_used_at: new Date().toISOString() })
        .eq('key_id', keyId)
        .then(() => {})
        .catch(() => {})
    }

    return { mode: 'service' }
  }

  const authHeader = req.headers['authorization'] as string | undefined
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    try {
      const payload = await clerk.verifyToken(token)
      return {
        mode: 'user',
        userId: payload.sub,
        orgId: (payload as any).org_id as string | undefined,
      }
    } catch {
      throw { statusCode: 401, message: 'Invalid token' }
    }
  }

  throw { statusCode: 401, message: 'Unauthorized' }
}

/** Convenience wrapper: send 401 on auth failure */
export async function withAuth(
  req: VercelRequest,
  res: any,
  handler: (ctx: AuthContext) => Promise<void>
): Promise<void> {
  try {
    const ctx = await authenticateRequest(req)
    await handler(ctx)
  } catch (err: any) {
    res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
}

// ── Legacy helpers kept for upload.ts backward compat ──────────────────────

export async function verifyAuth(req: any): Promise<AuthResult> {
  const serviceKey = req.headers['x-rbm-service-key']
  if (serviceKey) {
    if (serviceKey === process.env.SERVICE_API_KEY) {
      return { ok: true, userId: 'service', type: 'service' }
    }
    return { ok: false, error: 'Invalid service API key' }
  }

  const authHeader = req.headers['authorization']
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, error: 'No authorization header' }
  }

  const token = authHeader.slice(7)
  try {
    const payload = await clerk.verifyToken(token)
    return { ok: true, userId: payload.sub, type: 'clerk' }
  } catch {
    return { ok: false, error: 'Invalid token' }
  }
}

export function unauthorized(res: any, message = 'Unauthorized') {
  res.status(401).json({ error: message })
}
