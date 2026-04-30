// POST /api/clients/[clientId]/addon-cohorts/[offeringId]/override
// Body: { service_location_id, new_cohort_index, new_next_due_year }
// Manually moves a single property to a different cohort.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../../_lib/supabase.js'
import { authenticateRequest, type AuthContext } from '../../../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  let ctx: AuthContext
  try { ctx = await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const clientId = req.query.clientId as string
  const offeringId = req.query.offeringId as string
  const body = (req.body ?? {}) as Record<string, unknown>
  const slId = body.service_location_id as string | undefined
  const cohortIndex = body.new_cohort_index as number | undefined
  const nextDueYear = body.new_next_due_year as number | undefined
  if (!slId || cohortIndex == null || nextDueYear == null) {
    return res.status(400).json({ error: 'service_location_id, new_cohort_index, new_next_due_year required' })
  }
  const db = createAdminClient()
  const { error } = await db
    .from('addon_cohort_assignments')
    .update({
      cohort_index: cohortIndex,
      next_due_year: nextDueYear,
      assignment_method: 'manual_override',
      assigned_by: ctx.email ?? ctx.userId ?? 'manual',
      assigned_at: new Date().toISOString(),
    })
    .eq('service_location_id', slId)
    .eq('service_offering_id', offeringId)
    .eq('client_id', clientId)
  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ ok: true })
}
