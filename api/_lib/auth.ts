import { createClerkClient } from '@clerk/backend'
import type { IncomingMessage } from 'http'

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })

export type AuthResult =
  | { ok: true; userId: string; type: 'clerk' | 'service' }
  | { ok: false; error: string }

export async function verifyAuth(req: IncomingMessage): Promise<AuthResult> {
  // Service-to-service auth via X-RBM-Service-Key header
  const serviceKey = (req as any).headers['x-rbm-service-key']
  if (serviceKey) {
    if (serviceKey === process.env.SERVICE_API_KEY) {
      return { ok: true, userId: 'service', type: 'service' }
    }
    return { ok: false, error: 'Invalid service API key' }
  }

  // Clerk JWT auth
  const authHeader = (req as any).headers['authorization']
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, error: 'No authorization header' }
  }

  const token = authHeader.slice(7)
  try {
    const payload = await clerk.verifyToken(token)
    return { ok: true, userId: payload.sub, type: 'clerk' }
  } catch (err) {
    return { ok: false, error: 'Invalid token' }
  }
}

export function unauthorized(res: any, message = 'Unauthorized') {
  res.status(401).json({ error: message })
}
