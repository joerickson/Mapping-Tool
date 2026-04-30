// Phase 4f — undo stack helpers.
//
// Every cycle-level edit endpoint must:
//   1. Compute reverse_payload BEFORE applying the change
//   2. Apply the change
//   3. recordEdit() with both payloads
//   4. invalidateRedoBranch() to drop any newer-but-undone entries
import type { SupabaseClient } from '@supabase/supabase-js'

export type EditType =
  | 'move_visit'
  | 'move_trip'
  | 'reassign_cluster'
  | 'add_visit'
  | 'remove_visit'
  | 'lock_visit'
  | 'unlock_visit'
  | 'lock_day'
  | 'unlock_day'
  | 'mark_complete'
  | 'mark_cancelled'
  | 'bulk_operation'

export interface RecordEditInput {
  cycle_instance_id: string
  edit_type: EditType
  forward_payload: Record<string, unknown>
  reverse_payload: Record<string, unknown>
  description: string
  edited_by?: string | null
  propagated_to_template?: boolean
  template_change_payload?: Record<string, unknown> | null
}

export async function recordEdit(
  db: SupabaseClient,
  input: RecordEditInput
): Promise<{ id: string; edit_index: number }> {
  // Drop any "redo" branch — new edits invalidate previously-undone ones.
  await db
    .from('cycle_edit_history')
    .delete()
    .eq('cycle_instance_id', input.cycle_instance_id)
    .eq('is_active', false)

  // Next index = max(edit_index) + 1, or 1 if none.
  const { data: latest } = await db
    .from('cycle_edit_history')
    .select('edit_index')
    .eq('cycle_instance_id', input.cycle_instance_id)
    .order('edit_index', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextIndex = (latest as { edit_index?: number } | null)?.edit_index
    ? (latest as { edit_index: number }).edit_index + 1
    : 1

  const { data, error } = await db
    .from('cycle_edit_history')
    .insert({
      cycle_instance_id: input.cycle_instance_id,
      edit_index: nextIndex,
      edit_type: input.edit_type,
      forward_payload: input.forward_payload,
      reverse_payload: input.reverse_payload,
      propagated_to_template: input.propagated_to_template ?? false,
      template_change_payload: input.template_change_payload ?? null,
      description: input.description,
      edited_by: input.edited_by ?? null,
      is_active: true,
    })
    .select('id, edit_index')
    .single()
  if (error) throw new Error(`recordEdit: ${error.message}`)

  // Trim to last 50 active entries — keep the table bounded per cycle.
  await trimHistory(db, input.cycle_instance_id, 50)

  return data as { id: string; edit_index: number }
}

async function trimHistory(
  db: SupabaseClient,
  cycleInstanceId: string,
  keep: number
): Promise<void> {
  const { data: ids } = await db
    .from('cycle_edit_history')
    .select('id, edit_index')
    .eq('cycle_instance_id', cycleInstanceId)
    .eq('is_active', true)
    .order('edit_index', { ascending: false })
    .range(keep, keep + 1000) // anything past `keep`
  const toDelete = (ids ?? []).map((r) => (r as { id: string }).id)
  if (toDelete.length === 0) return
  await db.from('cycle_edit_history').delete().in('id', toDelete)
}

// Apply a payload to scheduled_visits — used by both the original
// edit endpoints and the undo/redo flow. Keeps the apply logic in one
// place so undo doesn't drift from the forward path.
export interface VisitMovePayload {
  visit_id: string
  to_date: string
  to_crew_index?: number
  to_sequence?: number
}
export async function applyVisitMove(
  db: SupabaseClient,
  payload: VisitMovePayload
): Promise<void> {
  const update: Record<string, unknown> = {
    scheduled_date: payload.to_date,
    updated_at: new Date().toISOString(),
  }
  if (payload.to_sequence != null) update.sequence_in_day = payload.to_sequence
  await db.from('scheduled_visits').update(update).eq('id', payload.visit_id)
}

export interface VisitLockPayload {
  visit_id: string
  is_locked: boolean
  locked_by?: string | null
}
export async function applyVisitLock(
  db: SupabaseClient,
  payload: VisitLockPayload
): Promise<void> {
  const update = payload.is_locked
    ? {
        is_locked: true,
        locked_at: new Date().toISOString(),
        locked_by: payload.locked_by ?? null,
        updated_at: new Date().toISOString(),
      }
    : {
        is_locked: false,
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      }
  await db.from('scheduled_visits').update(update).eq('id', payload.visit_id)
}

export interface VisitStatusPayload {
  visit_id: string
  status: 'placed' | 'completed' | 'cancelled' | 'unplaced'
  completed_at?: string | null
}
export async function applyVisitStatus(
  db: SupabaseClient,
  payload: VisitStatusPayload
): Promise<void> {
  const update: Record<string, unknown> = {
    status: payload.status,
    updated_at: new Date().toISOString(),
  }
  if (payload.status === 'completed') {
    update.completed_at = payload.completed_at ?? new Date().toISOString()
  } else if (payload.status === 'placed') {
    update.completed_at = null
  }
  await db.from('scheduled_visits').update(update).eq('id', payload.visit_id)
}

// Reverse application: given a history row, apply its reverse_payload
// based on edit_type. Returns the resulting state for the caller.
export async function applyReverse(
  db: SupabaseClient,
  edit_type: EditType,
  reverse: Record<string, unknown>
): Promise<void> {
  switch (edit_type) {
    case 'move_visit':
      await applyVisitMove(db, reverse as unknown as VisitMovePayload)
      break
    case 'lock_visit':
    case 'unlock_visit':
      await applyVisitLock(db, reverse as unknown as VisitLockPayload)
      break
    case 'mark_complete':
    case 'mark_cancelled':
      await applyVisitStatus(db, reverse as unknown as VisitStatusPayload)
      break
    default:
      // Other edit types not yet supported in undo; surface to caller.
      throw new Error(`Undo not yet supported for edit_type: ${edit_type}`)
  }
}

export async function applyForward(
  db: SupabaseClient,
  edit_type: EditType,
  forward: Record<string, unknown>
): Promise<void> {
  // Forward and reverse use the same applier shapes — they just carry
  // different "to" values.
  await applyReverse(db, edit_type, forward)
}
