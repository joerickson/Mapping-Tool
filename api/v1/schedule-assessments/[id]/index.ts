// GET    /api/v1/schedule-assessments/[id]
//   Returns assessment + files + (paginated) rows.
// PATCH  /api/v1/schedule-assessments/[id]
//   Update name, baseline_template_id, status.
// DELETE /api/v1/schedule-assessments/[id]
//   Soft-archives.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  try { await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const id = req.query.id as string
  const db = createAdminClient()

  if (req.method === 'GET') {
    const { data: assessment, error } = await db
      .from('schedule_assessments')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) return res.status(500).json({ error: error.message })
    if (!assessment) return res.status(404).json({ error: 'Not found' })

    const { data: files } = await db
      .from('schedule_assessment_files')
      .select('id, filename, cycle_label, row_count, uploaded_at')
      .eq('assessment_id', id)
      .order('uploaded_at', { ascending: true })

    // Page through rows — large uploads can exceed 1000.
    const PAGE = 1000
    const rows: any[] = []
    for (let p = 0; p < 50; p++) {
      const { data: batch } = await db
        .from('schedule_assessment_rows')
        .select('id, file_id, raw_address, raw_scheduled_date, raw_crew_name, raw_location_code, matched_service_location_id, match_confidence, match_status, match_candidates, notes')
        .eq('assessment_id', id)
        .order('created_at', { ascending: true })
        .range(p * PAGE, p * PAGE + PAGE - 1)
      const arr = batch ?? []
      rows.push(...arr)
      if (arr.length < PAGE) break
    }

    return res.status(200).json({
      assessment,
      files: files ?? [],
      rows,
    })
  }

  if (req.method === 'PATCH') {
    const body = (req.body ?? {}) as Record<string, unknown>
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof body.name === 'string') update.name = body.name.trim()
    if (body.baseline_template_id === null || typeof body.baseline_template_id === 'string') {
      update.baseline_template_id = body.baseline_template_id
    }
    if (typeof body.status === 'string') update.status = body.status
    const { data, error } = await db
      .from('schedule_assessments')
      .update(update)
      .eq('id', id)
      .select('*')
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ assessment: data })
  }

  if (req.method === 'DELETE') {
    const { error } = await db
      .from('schedule_assessments')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(204).end()
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
