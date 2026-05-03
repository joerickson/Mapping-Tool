// POST /api/scheduler/cycles/[cycleId]/apply-rebalance
//
// Applies a non-property rebalance suggestion (crew_relocate or
// crew_reduce) by patching the cycle's CLIENT operational_constraints
// row's crew_count_per_branch_override.
//
// Why on the cycle path: the dialog operator is in the cycle context,
// so we look up the cycle → template → client to find which constraints
// row to write. Property moves still go through
// /api/scheduler/templates/[templateId]/branch-overrides.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest, type AuthContext } from '../../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  let ctx: AuthContext
  try { ctx = await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const cycleId = req.query.cycleId as string
  const body = (req.body ?? {}) as {
    type?: 'staging_rebalance'
    proposed_per_branch?: Record<string, number>
  }
  if (!body.type) return res.status(400).json({ error: 'type required' })
  const db = createAdminClient()

  const { data: cycle } = await db
    .from('cycle_instances')
    .select('id, template_id')
    .eq('id', cycleId)
    .maybeSingle()
  if (!cycle) return res.status(404).json({ error: 'Cycle not found' })
  const { data: tpl } = await db
    .from('routing_templates')
    .select('account_id, client_id')
    .eq('id', (cycle as any).template_id)
    .maybeSingle()
  if (!tpl) return res.status(404).json({ error: 'Template not found' })
  const { account_id: accountId, client_id: clientId } = tpl as any

  // Read the current per-branch override.
  const { data: con } = await db
    .from('account_operational_constraints')
    .select('crew_count_per_branch_override')
    .eq('account_id', accountId)
    .eq('client_id', clientId)
    .maybeSingle()
  const current = ((con as any)?.crew_count_per_branch_override ?? {}) as Record<string, number>
  const next: Record<string, number> = {}
  for (const [k, v] of Object.entries(current)) {
    if (k === '__roving') continue // legacy — drop
    const n = Math.floor(Number(v) || 0)
    if (n > 0) next[k] = n
  }

  if (body.type === 'staging_rebalance') {
    if (!body.proposed_per_branch || typeof body.proposed_per_branch !== 'object') {
      return res.status(400).json({ error: 'proposed_per_branch required' })
    }
    // Replace the entire override with the proposed map. This is the
    // global re-staging: not a delta, the whole thing in one shot.
    const fresh: Record<string, number> = {}
    for (const [k, v] of Object.entries(body.proposed_per_branch)) {
      const n = Math.floor(Number(v) || 0)
      if (n > 0) fresh[k] = n
    }
    if (Object.keys(fresh).length === 0) {
      return res.status(400).json({ error: 'proposed_per_branch must have at least one positive entry' })
    }
    // Replace next entirely.
    for (const k of Object.keys(next)) delete next[k]
    Object.assign(next, fresh)
  } else {
    return res.status(400).json({ error: 'unsupported type' })
  }

  const { error: upErr } = await db
    .from('account_operational_constraints')
    .upsert(
      {
        account_id: accountId,
        client_id: clientId,
        crew_count_per_branch_override: next,
        updated_at: new Date().toISOString(),
        updated_by: ctx.userId ?? null,
      },
      { onConflict: 'account_id,client_id' }
    )
  if (upErr) return res.status(500).json({ error: `constraints upsert failed: ${upErr.message}` })

  const newTotal = Object.values(next).reduce((s, v) => s + v, 0)
  return res.status(200).json({
    crew_count_per_branch_override: next,
    new_total: newTotal,
  })
}
