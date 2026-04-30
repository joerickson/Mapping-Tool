// GET /api/analyses/account/[accountId]/clients/[clientId]/latest
// Returns the most recent portfolio_analyses row per module_key for this
// (account, client) pair. Used by the dashboard to populate cards on load.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../../../_lib/supabase.js'
import { authenticateRequest } from '../../../../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const accountId = req.query.accountId as string
  const clientId = req.query.clientId as string
  const db = createAdminClient()

  // Pull the most recent ~50 rows for this account; bucket client-side by module_key.
  const { data, error } = await db
    .from('portfolio_analyses')
    .select('id, account_id, client_id, module_key, status, outputs, summary_text, property_count, created_at, completed_at, error_message')
    .eq('account_id', accountId)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return res.status(500).json({ error: error.message })

  const seen = new Set<string>()
  const latest: any[] = []
  for (const row of data ?? []) {
    const r = row as any
    if (seen.has(r.module_key)) continue
    seen.add(r.module_key)
    latest.push(r)
  }
  return res.status(200).json(latest)
}
