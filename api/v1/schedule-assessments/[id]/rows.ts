// PATCH /api/v1/schedule-assessments/[id]/rows
//
// Bulk-update row match assignments. Body:
//   { rows: [{ id, matched_service_location_id?, match_status? }] }
// Used by the wizard's "review tray" to confirm fuzzy matches or
// manually pick an SL for an unmatched row.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' })
  try { await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const assessmentId = req.query.id as string
  const body = (req.body ?? {}) as {
    rows?: Array<{
      id: string
      matched_service_location_id?: string | null
      match_status?: string
      notes?: string | null
    }>
  }
  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return res.status(400).json({ error: 'rows array required' })
  }
  const db = createAdminClient()

  // Update one row at a time so we can scope to the assessment id
  // (prevents a malicious id list from updating rows on other
  // assessments).
  const VALID_STATUSES = new Set(['auto', 'manual', 'unmatched', 'skipped', 'pending'])
  for (const r of body.rows) {
    if (!r.id) continue
    const update: Record<string, unknown> = {}
    if ('matched_service_location_id' in r) {
      update.matched_service_location_id = r.matched_service_location_id ?? null
      // When the operator manually assigns, mark the status accordingly.
      if (!r.match_status) update.match_status = r.matched_service_location_id ? 'manual' : 'unmatched'
    }
    if (r.match_status && VALID_STATUSES.has(r.match_status)) {
      update.match_status = r.match_status
    }
    if ('notes' in r) update.notes = r.notes ?? null
    if (Object.keys(update).length === 0) continue
    await db
      .from('schedule_assessment_rows')
      .update(update)
      .eq('id', r.id)
      .eq('assessment_id', assessmentId)
  }

  await db
    .from('schedule_assessments')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', assessmentId)

  return res.status(200).json({ ok: true })
}
