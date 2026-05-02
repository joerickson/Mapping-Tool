// PATCH /api/scheduler/templates/[templateId]/branch-overrides
// Body: { service_location_id: string, branch_idx: number | null }
//
// Sets or clears a per-property branch override on a routing template.
// Set branch_idx = null to clear an override (property goes back to the
// engine's recommendation on next regenerate).
//
// The override is stored on routing_templates.branch_assignment_overrides
// and read by the engine in build-routing-template's rebalance pass.
// User MUST regenerate the template for overrides to affect the schedule.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PATCH' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const templateId = req.query.templateId as string
  const body = (req.body ?? {}) as {
    service_location_id?: string
    branch_idx?: number | null
    // Batch form: apply N overrides at once (used by the rebalance
    // suggestions modal). Single-form is preserved for backwards compat.
    batch?: Array<{ service_location_id: string; branch_idx: number | null }>
  }
  const isBatch = Array.isArray(body.batch) && body.batch.length > 0
  if (!isBatch && !body.service_location_id) {
    return res.status(400).json({ error: 'service_location_id or batch required' })
  }
  const db = createAdminClient()

  const { data: tpl, error: tplErr } = await db
    .from('routing_templates')
    .select('branch_assignment_overrides, branches')
    .eq('id', templateId)
    .maybeSingle()
  if (tplErr || !tpl) return res.status(404).json({ error: 'Template not found' })

  const overrides = ((tpl as any).branch_assignment_overrides ?? {}) as Record<string, number>
  const branches = ((tpl as any).branches ?? []) as any[]

  const applyOne = (sl: string, idx: number | null | undefined): string | null => {
    if (idx === null || idx === undefined) {
      delete overrides[sl]
      return null
    }
    if (!Number.isInteger(idx) || idx < 0 || idx >= branches.length) {
      return `branch_idx must be an integer in [0, ${branches.length - 1}] (got ${idx} for ${sl})`
    }
    overrides[sl] = idx
    return null
  }

  if (isBatch) {
    for (const item of body.batch!) {
      if (!item.service_location_id) continue
      const err = applyOne(item.service_location_id, item.branch_idx ?? null)
      if (err) return res.status(400).json({ error: err })
    }
  } else {
    const err = applyOne(body.service_location_id!, body.branch_idx)
    if (err) return res.status(400).json({ error: err })
  }

  const { error: updErr } = await db
    .from('routing_templates')
    .update({ branch_assignment_overrides: overrides, updated_at: new Date().toISOString() })
    .eq('id', templateId)
  if (updErr) return res.status(500).json({ error: updErr.message })

  return res.status(200).json({ ok: true, overrides })
}
