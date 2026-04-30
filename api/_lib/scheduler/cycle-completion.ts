// Phase 4e — cycle completion tracking.
//
// "Completion" treats both completed AND cancelled visits as "done with"
// the cycle (the work is no longer pending), so a cycle that's been
// fully cancelled reads as 100% complete. Unplaced visits never had a
// date; they're tracked separately and excluded from the denominator
// to avoid pinning completion below 100% when work just couldn't be
// scheduled.
import type { SupabaseClient } from '@supabase/supabase-js'

export interface CompletionResult {
  visits_total: number
  visits_completed: number
  visits_cancelled: number
  visits_unplaced: number
  completion_pct: number
  status_summary: string
}

export async function calculateCycleCompletion(
  db: SupabaseClient,
  cycleInstanceId: string
): Promise<CompletionResult> {
  const { data, error } = await db
    .from('scheduled_visits')
    .select('status')
    .eq('cycle_instance_id', cycleInstanceId)
  if (error) throw new Error(`scheduled_visits read failed: ${error.message}`)

  let completed = 0
  let cancelled = 0
  let unplaced = 0
  let other = 0
  for (const r of (data ?? []) as Array<{ status: string }>) {
    if (r.status === 'completed') completed++
    else if (r.status === 'cancelled') cancelled++
    else if (r.status === 'unplaced') unplaced++
    else other++
  }
  const total = completed + cancelled + other // exclude unplaced
  // 0 placed visits = vacuously complete (nothing to do).
  const completion_pct = total === 0 ? 100 : Math.round(((completed + cancelled) / total) * 1000) / 10

  return {
    visits_total: total,
    visits_completed: completed,
    visits_cancelled: cancelled,
    visits_unplaced: unplaced,
    completion_pct,
    status_summary: `${completed} completed · ${cancelled} cancelled · ${other} placed · ${unplaced} unplaced`,
  }
}

// Recompute completion + persist on the cycle_instances row. Also
// transitions cycle.status if appropriate (planned → in_progress on
// first completion; in_progress → completed at 100%). Returns the
// updated stats so the caller can short-circuit on no change.
export async function refreshCycleCompletion(
  db: SupabaseClient,
  cycleInstanceId: string
): Promise<{ stats: CompletionResult; status_changed_to: string | null }> {
  const stats = await calculateCycleCompletion(db, cycleInstanceId)

  // Read current cycle status to decide if we should transition.
  const { data: cycle } = await db
    .from('cycle_instances')
    .select('id, status, start_date')
    .eq('id', cycleInstanceId)
    .single()
  const currentStatus = (cycle as any)?.status as string | undefined
  let nextStatus: string | null = null
  if (currentStatus === 'planned' && (stats.visits_completed > 0 || stats.visits_cancelled > 0)) {
    nextStatus = 'in_progress'
  } else if (currentStatus === 'in_progress' && stats.completion_pct >= 100) {
    nextStatus = 'completed'
  }

  const update: Record<string, unknown> = {
    completion_pct: stats.completion_pct,
    visits_completed_count: stats.visits_completed,
    visits_total_count: stats.visits_total,
    completion_last_calculated_at: new Date().toISOString(),
  }
  if (nextStatus) update.status = nextStatus

  await db.from('cycle_instances').update(update).eq('id', cycleInstanceId)

  return { stats, status_changed_to: nextStatus }
}
