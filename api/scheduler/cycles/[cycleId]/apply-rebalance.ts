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
    type?: 'crew_relocate' | 'crew_reduce'
    from_branch_name?: string
    to_branch_name?: string
    branch_name?: string
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

  if (body.type === 'crew_relocate') {
    if (!body.from_branch_name || !body.to_branch_name) {
      return res.status(400).json({ error: 'from_branch_name + to_branch_name required' })
    }
    const fromN = next[body.from_branch_name] ?? 0
    if (fromN <= 0) {
      return res
        .status(400)
        .json({ error: `Cannot relocate from ${body.from_branch_name}: no crews staged there.` })
    }
    next[body.from_branch_name] = fromN - 1
    if (next[body.from_branch_name] === 0) delete next[body.from_branch_name]
    next[body.to_branch_name] = (next[body.to_branch_name] ?? 0) + 1
  } else if (body.type === 'crew_reduce') {
    if (!body.branch_name) return res.status(400).json({ error: 'branch_name required' })
    const cur = next[body.branch_name] ?? 0
    if (cur <= 0) {
      return res
        .status(400)
        .json({ error: `Cannot reduce ${body.branch_name}: no crews staged there.` })
    }
    next[body.branch_name] = cur - 1
    if (next[body.branch_name] === 0) delete next[body.branch_name]
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
