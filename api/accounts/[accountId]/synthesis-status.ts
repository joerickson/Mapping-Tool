// GET /api/accounts/[accountId]/synthesis-status
// Cheap polling endpoint for the dashboard's Synthesis card. Returns just
// status + summary text + completed_at, without the full report markdown
// or module results. The card polls this every 5s while the user is on the
// page; if status flips to 'stale' or completed_at advances, it refetches
// /api/analyses/[id] for the full row and (when stale) kicks off a fresh
// foreground synthesize call.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const accountId = req.query.accountId as string
  const db = createAdminClient()

  // Most recent synthesis row regardless of status — if it's stale or
  // running, the UI needs to know.
  const { data } = await db
    .from('portfolio_analyses')
    .select('id, status, summary_text, completed_at, created_at, error_message')
    .eq('account_id', accountId)
    .eq('module_key', 'synthesis')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Also detect a currently-in-flight run so the UI can keep its spinner
  // up even between completed rows.
  const { data: runningRow } = await db
    .from('portfolio_analyses')
    .select('id, created_at')
    .eq('account_id', accountId)
    .eq('module_key', 'synthesis')
    .eq('status', 'running')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const r = (data ?? null) as any
  return res.status(200).json({
    status: r?.status ?? 'none',
    last_synthesis_id: r?.id ?? null,
    last_synthesis_completed_at: r?.completed_at ?? null,
    last_synthesis_summary: r?.summary_text ?? null,
    last_synthesis_error: r?.status === 'failed' ? r?.error_message ?? null : null,
    current_run_started_at: (runningRow as any)?.created_at ?? null,
  })
}
