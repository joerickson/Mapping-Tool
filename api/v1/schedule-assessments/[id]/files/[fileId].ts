// DELETE /api/v1/schedule-assessments/[id]/files/[fileId]
//
// Removes one uploaded file. The schedule_assessment_rows ON DELETE
// CASCADE FK takes its rows with it. Used by the wizard to wipe a
// bad upload and start over without recreating the whole assessment.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../../_lib/supabase.js'
import { authenticateRequest } from '../../../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' })
  try { await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const assessmentId = req.query.id as string
  const fileId = req.query.fileId as string
  const db = createAdminClient()

  // Scoped delete — file must belong to the assessment to be removed.
  const { error } = await db
    .from('schedule_assessment_files')
    .delete()
    .eq('id', fileId)
    .eq('assessment_id', assessmentId)
  if (error) return res.status(500).json({ error: error.message })

  await db
    .from('schedule_assessments')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', assessmentId)

  return res.status(204).end()
}
