// POST /api/v1/schedule-assessments/[id]/detect
//   Runs the constraint detector against this assessment's matched
//   rows. Persists findings to schedule_assessment_constraints with
//   status='detected'. Replaces any existing 'detected' rows but
//   preserves operator-accepted/rejected/edited choices.
//
// GET  /api/v1/schedule-assessments/[id]/detect
//   Returns the latest set of detection findings (sorted highest
//   confidence first).
//
// PATCH /api/v1/schedule-assessments/[id]/detect
//   Body: { id, status: 'accepted'|'rejected'|'edited' }. Operator
//   decision per finding.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import { detectConstraints } from '../../../_lib/schedule-assessment/detect-constraints.js'

export const config = { maxDuration: 60 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try { await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const id = req.query.id as string
  const db = createAdminClient()

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('schedule_assessment_constraints')
      .select('*')
      .eq('assessment_id', id)
      .order('confidence', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ constraints: data ?? [] })
  }

  if (req.method === 'POST') {
    const { count: fileCount } = await db
      .from('schedule_assessment_files')
      .select('id', { count: 'exact', head: true })
      .eq('assessment_id', id)

    // Run detection.
    const findings = await detectConstraints(db, {
      assessment_id: id,
      file_count: fileCount ?? 1,
    })

    // Replace existing 'detected' rows with the fresh set; preserve
    // any rows the operator has already accepted/rejected/edited.
    await db
      .from('schedule_assessment_constraints')
      .delete()
      .eq('assessment_id', id)
      .eq('status', 'detected')

    if (findings.length > 0) {
      const insertRows = findings.map((f) => ({
        assessment_id: id,
        detection_type: f.detection_type,
        scope_type: f.scope_type,
        scope_ids: f.scope_ids,
        pattern: f.pattern,
        confidence: f.confidence,
        status: 'detected' as const,
      }))
      const { error } = await db
        .from('schedule_assessment_constraints')
        .insert(insertRows)
      if (error) return res.status(500).json({ error: error.message })
    }

    const { data: all } = await db
      .from('schedule_assessment_constraints')
      .select('*')
      .eq('assessment_id', id)
      .order('confidence', { ascending: false })

    return res.status(200).json({ constraints: all ?? [], detected_count: findings.length })
  }

  if (req.method === 'PATCH') {
    const body = (req.body ?? {}) as { id?: string; status?: string }
    if (!body.id || !body.status) return res.status(400).json({ error: 'id + status required' })
    const VALID = new Set(['detected', 'accepted', 'rejected', 'edited'])
    if (!VALID.has(body.status)) return res.status(400).json({ error: 'invalid status' })
    const { error } = await db
      .from('schedule_assessment_constraints')
      .update({ status: body.status, updated_at: new Date().toISOString() })
      .eq('assessment_id', id)
      .eq('id', body.id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
