// POST /api/scheduler/visits/bulk-action
// Body: { visit_ids: uuid[], action: 'move' | 'lock' | 'unlock' | 'mark_complete', payload?: ... }
//
// Applies the action to N visits and records ONE 'bulk_operation' edit
// in the cycle's history (so a single Cmd+Z reverts the whole bulk).
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest, type AuthContext } from '../../_lib/auth.js'
import {
  applyVisitMove,
  applyVisitLock,
  applyVisitStatus,
  recordEdit,
} from '../../_lib/scheduler/edit-history.js'
import { moveVisit } from '../../_lib/scheduler/edit-propagation.js'

export const config = { maxDuration: 60 }

type BulkAction = 'move' | 'lock' | 'unlock' | 'mark_complete'

interface Body {
  visit_ids?: string[]
  action?: BulkAction
  payload?: Record<string, unknown>
}

const MAX_VISITS = 500

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  let ctx: AuthContext
  try { ctx = await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const body = (req.body ?? {}) as Body
  const visitIds = body.visit_ids ?? []
  const action = body.action
  if (!action || !['move', 'lock', 'unlock', 'mark_complete'].includes(action)) {
    return res.status(400).json({ error: 'action must be move|lock|unlock|mark_complete' })
  }
  if (visitIds.length === 0) return res.status(400).json({ error: 'visit_ids required' })
  if (visitIds.length > MAX_VISITS) return res.status(400).json({ error: `cap is ${MAX_VISITS}` })

  const db = createAdminClient()

  // Snapshot pre-edit state for reverse_payload entries.
  const { data: before } = await db
    .from('scheduled_visits')
    .select('id, cycle_instance_id, scheduled_date, sequence_in_day, is_locked, locked_by, status, completed_at, service_locations(display_name)')
    .in('id', visitIds)
  const beforeMap = new Map<string, any>()
  let cycleId: string | null = null
  for (const r of before ?? []) {
    const row = r as any
    beforeMap.set(row.id, row)
    if (!cycleId) cycleId = row.cycle_instance_id
  }
  if (!cycleId) return res.status(404).json({ error: 'No matching visits' })

  const forward: any[] = []
  const reverse: any[] = []
  const skipped: string[] = []

  const userId = ctx.email ?? ctx.userId ?? null

  for (const id of visitIds) {
    const cur = beforeMap.get(id)
    if (!cur) {
      skipped.push(id)
      continue
    }
    try {
      if (action === 'move') {
        const newDate = body.payload?.to_date as string | undefined
        if (!newDate) continue
        const propagate = body.payload?.propagate_to_template === true
        if (propagate) {
          // Use the propagation helper so template.trips is also updated.
          // moveVisit handles per-row propagation under the hood.
          await moveVisit(db, {
            visitId: id,
            newScheduledDate: newDate,
            propagateToTemplate: true,
            editedBy: userId,
          })
        } else {
          await applyVisitMove(db, { visit_id: id, to_date: newDate })
        }
        forward.push({ visit_id: id, to_date: newDate })
        reverse.push({ visit_id: id, to_date: cur.scheduled_date, to_sequence: cur.sequence_in_day })
      } else if (action === 'lock') {
        await applyVisitLock(db, { visit_id: id, is_locked: true, locked_by: userId })
        forward.push({ visit_id: id, is_locked: true, locked_by: userId })
        reverse.push({ visit_id: id, is_locked: !!cur.is_locked, locked_by: cur.locked_by })
      } else if (action === 'unlock') {
        await applyVisitLock(db, { visit_id: id, is_locked: false })
        forward.push({ visit_id: id, is_locked: false })
        reverse.push({ visit_id: id, is_locked: !!cur.is_locked, locked_by: cur.locked_by })
      } else if (action === 'mark_complete') {
        const completionDate = (body.payload?.completion_date as string | undefined) ?? new Date().toISOString().slice(0, 10)
        await applyVisitStatus(db, { visit_id: id, status: 'completed', completed_at: completionDate })
        forward.push({ visit_id: id, status: 'completed', completed_at: completionDate })
        reverse.push({ visit_id: id, status: cur.status ?? 'placed', completed_at: cur.completed_at ?? null })
      }
    } catch (err) {
      console.error(`bulk-action failed on ${id}:`, err)
      skipped.push(id)
    }
  }

  if (forward.length > 0) {
    try {
      await recordEdit(db, {
        cycle_instance_id: cycleId,
        edit_type: 'bulk_operation',
        forward_payload: { action, items: forward },
        reverse_payload: { action: reverseAction(action), items: reverse },
        description: bulkDescription(action, forward.length),
        edited_by: userId,
        propagated_to_template: action === 'move' && body.payload?.propagate_to_template === true,
      })
    } catch (err) {
      console.error('[bulk-action] history record failed:', err)
    }
  }

  // Phase 4e — refresh cycle completion stats after bulk mark_complete.
  if (action === 'mark_complete' && cycleId) {
    try {
      const { refreshCycleCompletion } = await import(
        '../../_lib/scheduler/cycle-completion.js'
      )
      await refreshCycleCompletion(db, cycleId)
    } catch (err) {
      console.error('[bulk-action] completion refresh failed:', err)
    }
  }

  return res.status(200).json({
    applied: forward.length,
    skipped: skipped.length,
    skipped_ids: skipped,
  })
}

function reverseAction(a: BulkAction): BulkAction {
  if (a === 'lock') return 'unlock'
  if (a === 'unlock') return 'lock'
  return a // move and mark_complete reverse via per-item payload
}

function bulkDescription(action: BulkAction, n: number): string {
  switch (action) {
    case 'move': return `Moved ${n} visit${n === 1 ? '' : 's'}`
    case 'lock': return `Locked ${n} visit${n === 1 ? '' : 's'}`
    case 'unlock': return `Unlocked ${n} visit${n === 1 ? '' : 's'}`
    case 'mark_complete': return `Marked ${n} visit${n === 1 ? '' : 's'} completed`
  }
}
