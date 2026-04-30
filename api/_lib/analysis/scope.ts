// Phase 3.6 helper — extract & validate (accountId, clientId) from a
// VercelRequest. Every analysis endpoint goes through this so the auth shape
// stays consistent. Validates that the client belongs to the account, returns
// a 404-shaped response if not.
import type { VercelRequest } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface Scope {
  accountId: string
  clientId: string
}

export interface ScopeError {
  status: number
  body: { error: string; code?: string }
}

export async function resolveScope(
  req: VercelRequest,
  db: SupabaseClient
): Promise<{ ok: true; scope: Scope } | { ok: false } & ScopeError> {
  const accountId = (req.query.accountId as string) ?? ''
  const clientId = (req.query.clientId as string) ?? ''
  if (!accountId || !clientId) {
    return {
      ok: false,
      status: 400,
      body: { error: 'accountId and clientId are required' },
    }
  }

  const { data, error } = await db
    .from('clients')
    .select('id, account_id')
    .eq('id', clientId)
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) {
    return {
      ok: false,
      status: 500,
      body: { error: `client lookup failed: ${error.message}` },
    }
  }
  if (!data) {
    return {
      ok: false,
      status: 404,
      body: {
        error: 'Client not found or does not belong to this account',
        code: 'CLIENT_NOT_IN_ACCOUNT',
      },
    }
  }
  return { ok: true, scope: { accountId, clientId } }
}

// Convenience for endpoints that only need to extract — no DB validation.
// Use this when the validation is already covered by a path operation
// (e.g. inserting with FK constraints will fail anyway). Prefer resolveScope
// for read endpoints where the user might be poking at URLs by hand.
export function extractScope(req: VercelRequest): Scope | null {
  const accountId = (req.query.accountId as string) ?? ''
  const clientId = (req.query.clientId as string) ?? ''
  if (!accountId || !clientId) return null
  return { accountId, clientId }
}

// Standard 410 Gone shim body for the old account-scoped routes.
export const MOVED_TO_CLIENT_SCOPE = {
  status: 410,
  body: {
    error:
      'Analysis is now scoped per-client. Use /accounts/[accountId]/clients/[clientId]/... endpoints.',
    code: 'MOVED_TO_CLIENT_SCOPE' as const,
  },
}
