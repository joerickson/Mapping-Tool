// POST /api/scheduler/visits/[visitId]/mark-completed
// Body: { completion_date?: 'YYYY-MM-DD' }
// Bumps cohort assignments for any attached addons (last_completed_date,
// next_due_year += cohort_total).
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import { markVisitCompleted } from '../../../_lib/scheduler/edit-propagation.js'
import { recordEdit } from '../../../_lib/scheduler/edit-history.js'
import { refreshCycleCompletion } from '../../../_lib/scheduler/cycle-completion.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  let ctx
  try { ctx = await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const visitId = req.query.visitId as string
  const body = (req.body ?? {}) as Record<string, unknown>
  const completionDate = (body.completion_date as string | undefined) ?? null
  const db = createAdminClient()
  const { data: before } = await db
    .from('scheduled_visits')
    .select('cycle_instance_id, status, completed_at, service_locations(display_name)')
    .eq('id', visitId)
    .single()
  const beforeRow = before as any
  try {
    const result = await markVisitCompleted(db, visitId, completionDate)
    if (beforeRow?.cycle_instance_id) {
      const addr = beforeRow.service_locations?.display_name ?? visitId.slice(0, 8)
      try {
        await recordEdit(db, {
          cycle_instance_id: beforeRow.cycle_instance_id,
          edit_type: 'mark_complete',
          forward_payload: {
            visit_id: visitId,
            status: 'completed',
            completed_at: completionDate ?? new Date().toISOString().slice(0, 10),
          },
          reverse_payload: {
            visit_id: visitId,
            status: beforeRow.status ?? 'placed',
            completed_at: beforeRow.completed_at ?? null,
          },
          description: `Marked "${addr}" completed`,
          edited_by: ctx.email ?? ctx.userId ?? null,
        })
      } catch (err) {
        console.error('[mark-completed] history record failed:', err)
      }
    }
    // Phase 4e — refresh the cycle's completion stats so the UI banner
    // and auto-generation trigger see the latest count immediately.
    // Then opportunistically check the auto-generation trigger so a
    // visit completion that crosses the threshold doesn't have to wait
    // for the daily cron.
    if (beforeRow?.cycle_instance_id) {
      try {
        await refreshCycleCompletion(db, beforeRow.cycle_instance_id)
      } catch (err) {
        console.error('[mark-completed] completion refresh failed:', err)
      }
      try {
        const { checkAndTriggerAutoGeneration } = await import(
          '../../../_lib/scheduler/auto-generation.js'
        )
        await checkAndTriggerAutoGeneration(db, beforeRow.cycle_instance_id)
      } catch (err) {
        console.error('[mark-completed] auto-generation check failed:', err)
      }
    }
    return res.status(200).json(result)
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? String(err) })
  }
}
