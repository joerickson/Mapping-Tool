// POST /api/scheduler/visits/[visitId]/move
// Body: { new_scheduled_date?, new_crew_index?, new_sequence?, propagate_to_template: boolean }
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest, type AuthContext } from '../../../_lib/auth.js'
import { moveVisit } from '../../../_lib/scheduler/edit-propagation.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  let ctx: AuthContext
  try { ctx = await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const visitId = req.query.visitId as string
  const body = (req.body ?? {}) as Record<string, unknown>
  const db = createAdminClient()
  try {
    const result = await moveVisit(db, {
      visitId,
      newScheduledDate: body.new_scheduled_date as string | undefined,
      newCrewIndex: body.new_crew_index as number | undefined,
      newSequenceInDay: body.new_sequence as number | undefined,
      propagateToTemplate: body.propagate_to_template === true,
      editedBy: ctx.email ?? ctx.userId ?? null,
    })
    return res.status(200).json(result)
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? String(err) })
  }
}
