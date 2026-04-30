// POST /api/scheduler/visits/[visitId]/mark-completed
// Body: { completion_date?: 'YYYY-MM-DD' }
// Bumps cohort assignments for any attached addons (last_completed_date,
// next_due_year += cohort_total).
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import { markVisitCompleted } from '../../../_lib/scheduler/edit-propagation.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try { await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const visitId = req.query.visitId as string
  const body = (req.body ?? {}) as Record<string, unknown>
  const completionDate = (body.completion_date as string | undefined) ?? null
  const db = createAdminClient()
  try {
    const result = await markVisitCompleted(db, visitId, completionDate)
    return res.status(200).json(result)
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? String(err) })
  }
}
