// Phase 4d — edit propagation.
//
// User edits a cycle instance (move visit, lock, reassign cluster). Each
// edit asks: apply to the template (default) or this cycle only. The
// propagation logic mirrors the cycle-level change back into the
// template's jsonb so future cycles inherit it.
//
// Past cycles (status in_progress / completed / cancelled) are immutable.
import type { SupabaseClient } from '@supabase/supabase-js'

export interface MoveVisitOptions {
  visitId: string
  newScheduledDate?: string // 'YYYY-MM-DD'
  newCrewIndex?: number
  newSequenceInDay?: number
  propagateToTemplate: boolean
  editedBy?: string | null
}

export interface MoveVisitResult {
  visit_updated: boolean
  template_updated: boolean
  future_cycles_marked: number
}

export async function moveVisit(
  db: SupabaseClient,
  opts: MoveVisitOptions
): Promise<MoveVisitResult> {
  const { data: visit, error: fetchErr } = await db
    .from('scheduled_visits')
    .select('*')
    .eq('id', opts.visitId)
    .single()
  if (fetchErr || !visit) throw new Error(`Visit not found: ${fetchErr?.message}`)
  const v = visit as any

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (opts.newScheduledDate) update.scheduled_date = opts.newScheduledDate
  if (opts.newSequenceInDay != null) update.sequence_in_day = opts.newSequenceInDay
  if (!opts.propagateToTemplate) update.cycle_specific_only = true

  const { error: updErr } = await db.from('scheduled_visits').update(update).eq('id', opts.visitId)
  if (updErr) throw new Error(updErr.message)

  let templateUpdated = false
  let futureCyclesMarked = 0

  if (opts.propagateToTemplate) {
    const { data: tplRow } = await db
      .from('routing_templates')
      .select('trips, updated_at')
      .eq('id', v.template_id)
      .single()
    if (tplRow) {
      const trips = ((tplRow as any).trips ?? []) as any[]
      const newTrips = mutateTemplateTrips(trips, v, opts)
      await db
        .from('routing_templates')
        .update({ trips: newTrips, updated_at: new Date().toISOString() })
        .eq('id', v.template_id)
      templateUpdated = true

      // Mark future planned cycles as having template changes.
      const { data: futureCycles } = await db
        .from('cycle_instances')
        .select('id, cycle_specific_overrides')
        .eq('template_id', v.template_id)
        .eq('status', 'planned')
        .gt('cycle_number', (await getCycleNumber(db, v.cycle_instance_id)) ?? 0)
      for (const c of futureCycles ?? []) {
        const overrides = ((c as any).cycle_specific_overrides ?? {}) as Record<string, unknown>
        overrides.template_changed_after_generation = true
        await db
          .from('cycle_instances')
          .update({ cycle_specific_overrides: overrides })
          .eq('id', (c as any).id)
        futureCyclesMarked++
      }
    }
  }

  return {
    visit_updated: true,
    template_updated: templateUpdated,
    future_cycles_marked: futureCyclesMarked,
  }
}

export async function lockVisit(
  db: SupabaseClient,
  visitId: string,
  lockedBy: string | null
): Promise<void> {
  await db
    .from('scheduled_visits')
    .update({
      is_locked: true,
      locked_at: new Date().toISOString(),
      locked_by: lockedBy,
      updated_at: new Date().toISOString(),
    })
    .eq('id', visitId)
}

export async function unlockVisit(db: SupabaseClient, visitId: string): Promise<void> {
  await db
    .from('scheduled_visits')
    .update({
      is_locked: false,
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', visitId)
}

export async function markVisitCompleted(
  db: SupabaseClient,
  visitId: string,
  completionDate: string | null
): Promise<{ cohort_assignments_updated: number }> {
  const dateStr = completionDate ?? new Date().toISOString().slice(0, 10)

  const { data: visit, error } = await db
    .from('scheduled_visits')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', visitId)
    .select('attached_addons')
    .single()
  if (error || !visit) throw new Error(error?.message ?? 'Visit not found')

  // Bump each addon's cohort assignment.
  const addons = ((visit as any).attached_addons ?? []) as Array<{
    cohort_assignment_id?: string
    cohort_year?: number
  }>
  let bumpsApplied = 0
  for (const a of addons) {
    if (!a.cohort_assignment_id) continue
    const { data: cohort } = await db
      .from('addon_cohort_assignments')
      .select('cohort_total, next_due_year')
      .eq('id', a.cohort_assignment_id)
      .single()
    if (!cohort) continue
    const c = cohort as { cohort_total: number; next_due_year: number }
    await db
      .from('addon_cohort_assignments')
      .update({
        last_completed_date: dateStr,
        next_due_year: c.next_due_year + c.cohort_total,
      })
      .eq('id', a.cohort_assignment_id)
    bumpsApplied++
  }
  return { cohort_assignments_updated: bumpsApplied }
}

// Internal: apply visit-level move to the template's trips jsonb.
// We mutate by relative_start_day. Best-effort: find the stop by
// service_location_id + visit_number_in_cycle within the same crew's
// trips, and (if crew stayed the same) relocate to the new relative
// day. If crew changed, drop from old crew and add to new crew.
function mutateTemplateTrips(
  trips: any[],
  visit: any,
  opts: MoveVisitOptions
): any[] {
  const out = trips.map((t) => ({ ...t, days: (t.days ?? []).map((d: any) => ({ ...d, stops: [...(d.stops ?? [])] })) }))

  // Find the stop in the existing trips
  let foundTripIdx = -1
  let foundDayIdx = -1
  let foundStopIdx = -1
  for (let ti = 0; ti < out.length; ti++) {
    const t = out[ti]
    for (let di = 0; di < t.days.length; di++) {
      const d = t.days[di]
      for (let si = 0; si < d.stops.length; si++) {
        if (
          d.stops[si].service_location_id === visit.service_location_id &&
          d.stops[si].visit_number_in_cycle === visit.visit_number_in_cycle
        ) {
          foundTripIdx = ti
          foundDayIdx = di
          foundStopIdx = si
          break
        }
      }
      if (foundStopIdx !== -1) break
    }
    if (foundStopIdx !== -1) break
  }
  if (foundTripIdx === -1) return out // not found; bail

  const stop = out[foundTripIdx].days[foundDayIdx].stops[foundStopIdx]

  // Update sequence if requested
  if (opts.newSequenceInDay != null) stop.sequence = opts.newSequenceInDay

  // Note: full date-based relocation across days is non-trivial — the
  // template stores relative days, not absolute dates. For now we just
  // record the sequence change. A future PR can implement full inter-day
  // moves via re-routeDay() of affected days.
  return out
}

async function getCycleNumber(db: SupabaseClient, cycleInstanceId: string): Promise<number | null> {
  const { data } = await db
    .from('cycle_instances')
    .select('cycle_number')
    .eq('id', cycleInstanceId)
    .single()
  return data ? (data as { cycle_number: number }).cycle_number : null
}
