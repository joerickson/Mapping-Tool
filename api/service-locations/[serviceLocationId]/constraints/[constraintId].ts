// PUT    /api/service-locations/[serviceLocationId]/constraints/[constraintId]
//        body: { constraint_type?, enforcement?, config?, notes? }
//        → partial update. Re-validates if type/enforcement/config touched.
// DELETE /api/service-locations/[serviceLocationId]/constraints/[constraintId]

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import { validateConstraint } from '../../../_lib/analysis/constraint-validators.js'

export const config = { maxDuration: 10 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await authenticateRequest(req)
  } catch (err) {
    const e = err as { statusCode?: number; message?: string }
    return res.status(e.statusCode ?? 401).json({ error: e.message ?? 'Unauthorized' })
  }

  const serviceLocationId = req.query.serviceLocationId as string
  const constraintId = req.query.constraintId as string
  if (!serviceLocationId || !constraintId) {
    return res.status(400).json({ error: 'serviceLocationId and constraintId required' })
  }

  const db = createAdminClient()

  // Verify the constraint belongs to the service_location in the URL.
  // Prevents a caller with a known constraintId from mutating a row under a
  // different SL just by changing the path.
  const { data: existing, error: fetchErr } = await db
    .from('service_location_constraints')
    .select('id, service_location_id, constraint_type, enforcement, config')
    .eq('id', constraintId)
    .maybeSingle()

  if (fetchErr) return res.status(500).json({ error: fetchErr.message })
  if (!existing) return res.status(404).json({ error: 'Constraint not found' })
  if (existing.service_location_id !== serviceLocationId) {
    return res.status(404).json({ error: 'Constraint not found on this service location' })
  }

  if (req.method === 'PUT') {
    const body = (req.body ?? {}) as Record<string, unknown>

    const merged = {
      constraint_type: typeof body.constraint_type === 'string' ? body.constraint_type : existing.constraint_type,
      enforcement: typeof body.enforcement === 'string' ? body.enforcement : existing.enforcement,
      config: body.config !== undefined ? body.config : existing.config,
      notes: body.notes as string | null | undefined,
    }

    const result = validateConstraint(merged)
    if (!result.ok) {
      return res.status(400).json({ error: 'Invalid constraint', details: result.errors })
    }

    const update: Record<string, unknown> = {
      constraint_type: result.normalized!.constraint_type,
      enforcement: result.normalized!.enforcement,
      config: result.normalized!.config,
      updated_at: new Date().toISOString(),
    }
    if (body.notes !== undefined) {
      update.notes =
        typeof body.notes === 'string' && body.notes.trim().length > 0 ? body.notes.trim() : null
    }

    const { data: updated, error: updateErr } = await db
      .from('service_location_constraints')
      .update(update)
      .eq('id', constraintId)
      .select('*')
      .single()

    if (updateErr) return res.status(500).json({ error: updateErr.message })
    return res.status(200).json({ constraint: updated })
  }

  if (req.method === 'DELETE') {
    const { error } = await db
      .from('service_location_constraints')
      .delete()
      .eq('id', constraintId)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(204).end()
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
