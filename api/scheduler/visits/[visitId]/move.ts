// POST /api/scheduler/visits/[visitId]/move
// Body: { new_scheduled_date?, new_crew_index?, new_sequence?, propagate_to_template: boolean }
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest, type AuthContext } from '../../../_lib/auth.js'
import { moveVisit } from '../../../_lib/scheduler/edit-propagation.js'
import { recordEdit } from '../../../_lib/scheduler/edit-history.js'

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
    // Snapshot pre-edit state for the reverse payload + history description.
    const { data: before } = await db
      .from('scheduled_visits')
      .select('cycle_instance_id, scheduled_date, sequence_in_day, service_locations(display_name, property:properties(address_line1))')
      .eq('id', visitId)
      .single()
    const beforeRow = before as any

    const result = await moveVisit(db, {
      visitId,
      newScheduledDate: body.new_scheduled_date as string | undefined,
      newCrewIndex: body.new_crew_index as number | undefined,
      newSequenceInDay: body.new_sequence as number | undefined,
      propagateToTemplate: body.propagate_to_template === true,
      editedBy: ctx.email ?? ctx.userId ?? null,
    })

    if (beforeRow?.cycle_instance_id) {
      const newDate = (body.new_scheduled_date as string | undefined) ?? beforeRow.scheduled_date
      const newSeq = (body.new_sequence as number | undefined) ?? beforeRow.sequence_in_day
      const addr = beforeRow.service_locations?.display_name
        ?? beforeRow.service_locations?.property?.address_line1
        ?? visitId.slice(0, 8)
      try {
        await recordEdit(db, {
          cycle_instance_id: beforeRow.cycle_instance_id,
          edit_type: 'move_visit',
          forward_payload: {
            visit_id: visitId,
            to_date: newDate,
            to_sequence: newSeq,
          },
          reverse_payload: {
            visit_id: visitId,
            to_date: beforeRow.scheduled_date,
            to_sequence: beforeRow.sequence_in_day,
          },
          description: `Moved "${addr}" from ${beforeRow.scheduled_date} to ${newDate}`,
          edited_by: ctx.email ?? ctx.userId ?? null,
          propagated_to_template: result.template_updated,
        })
      } catch (err) {
        console.error('[move-visit] history record failed:', err)
      }
    }
    return res.status(200).json(result)
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? String(err) })
  }
}
