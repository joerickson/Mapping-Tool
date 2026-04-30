// GET    /api/service-locations/[serviceLocationId]/constraints
//        → list all constraints attached to this service location
// POST   /api/service-locations/[serviceLocationId]/constraints
//        body: { constraint_type, enforcement, config, notes? }
//        → create a constraint. account_id/client_id are pulled from the
//        parent service_location row so the caller can't lie about scope.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest, type AuthContext } from '../../../_lib/auth.js'
import { validateConstraint } from '../../../_lib/analysis/constraint-validators.js'

export const config = { maxDuration: 10 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  let ctx: AuthContext
  try {
    ctx = await authenticateRequest(req)
  } catch (err) {
    const e = err as { statusCode?: number; message?: string }
    return res.status(e.statusCode ?? 401).json({ error: e.message ?? 'Unauthorized' })
  }

  const serviceLocationId = req.query.serviceLocationId as string
  if (!serviceLocationId) return res.status(400).json({ error: 'serviceLocationId required' })

  const db = createAdminClient()

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('service_location_constraints')
      .select('*')
      .eq('service_location_id', serviceLocationId)
      .order('created_at', { ascending: true })

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ constraints: data ?? [] })
  }

  if (req.method === 'POST') {
    const body = (req.body ?? {}) as Record<string, unknown>
    const result = validateConstraint({
      constraint_type: String(body.constraint_type ?? ''),
      enforcement: String(body.enforcement ?? ''),
      config: body.config,
      notes: body.notes as string | null | undefined,
    })
    if (!result.ok) {
      return res.status(400).json({ error: 'Invalid constraint', details: result.errors })
    }

    const { data: sl, error: slErr } = await db
      .from('service_locations')
      .select('id, account_id, client_id')
      .eq('id', serviceLocationId)
      .maybeSingle()

    if (slErr) return res.status(500).json({ error: slErr.message })
    if (!sl) return res.status(404).json({ error: 'Service location not found' })
    if (!sl.account_id) {
      return res.status(400).json({ error: 'Service location has no account_id — cannot scope constraint' })
    }

    const { data: inserted, error: insertErr } = await db
      .from('service_location_constraints')
      .insert({
        service_location_id: serviceLocationId,
        account_id: sl.account_id,
        client_id: sl.client_id,
        constraint_type: result.normalized!.constraint_type,
        enforcement: result.normalized!.enforcement,
        config: result.normalized!.config,
        notes: typeof body.notes === 'string' && body.notes.trim().length > 0 ? body.notes.trim() : null,
        created_by: ctx.email ?? ctx.userId ?? null,
      })
      .select('*')
      .single()

    if (insertErr) return res.status(500).json({ error: insertErr.message })
    return res.status(201).json({ constraint: inserted })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
