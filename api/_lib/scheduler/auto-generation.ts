// Phase 4e — auto-generation trigger.
//
// For an in-progress cycle: if completion ≥ template threshold AND we
// have at least lead_days runway before cycle.end_date AND no next
// cycle exists yet AND auto-generate is enabled on the template, then
// generate the next cycle, run preflight on it, and link the cycles.
import type { SupabaseClient } from '@supabase/supabase-js'
import { calculateCycleCompletion } from './cycle-completion.js'
import { generateCycleInstance } from './generate-cycle-instance.js'
import { runPreflightChecks, persistPreflightResults } from './preflight-checks.js'

export interface AutoGenerationOutcome {
  action: 'triggered' | 'deferred' | 'skipped' | 'blocked'
  reason?: string
  new_cycle_id?: string
  preflight_summary?: {
    blocking: number
    warning: number
    info: number
  }
}

function addDaysIso(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

function daysBetween(a: string, b: string): number {
  const ad = new Date(`${a}T00:00:00Z`).getTime()
  const bd = new Date(`${b}T00:00:00Z`).getTime()
  return Math.round((bd - ad) / 86400000)
}

export async function checkAndTriggerAutoGeneration(
  db: SupabaseClient,
  cycleId: string,
  options: { force?: boolean } = {}
): Promise<AutoGenerationOutcome> {
  const { data: cycle, error: cErr } = await db
    .from('cycle_instances')
    .select('id, template_id, cycle_number, status, end_date, next_cycle_id')
    .eq('id', cycleId)
    .single()
  if (cErr || !cycle) return { action: 'skipped', reason: 'cycle_not_found' }
  const c = cycle as any

  if (c.next_cycle_id) {
    return { action: 'skipped', reason: 'next_cycle_already_exists' }
  }
  if (!options.force && c.status !== 'in_progress') {
    return { action: 'skipped', reason: `cycle_status_${c.status}` }
  }

  const { data: tpl, error: tErr } = await db
    .from('routing_templates')
    .select(
      'id, cycle_length_days, auto_generate_enabled, auto_generate_at_completion_pct, auto_generate_lead_days'
    )
    .eq('id', c.template_id)
    .single()
  if (tErr || !tpl) return { action: 'skipped', reason: 'template_not_found' }
  const t = tpl as any

  if (!options.force && t.auto_generate_enabled === false) {
    return { action: 'skipped', reason: 'auto_generate_disabled_on_template' }
  }

  // Completion threshold check (skipped on force).
  if (!options.force) {
    const stats = await calculateCycleCompletion(db, cycleId)
    const threshold = Number(t.auto_generate_at_completion_pct ?? 80)
    if (stats.completion_pct < threshold) {
      return {
        action: 'skipped',
        reason: `below_completion_threshold (${stats.completion_pct}% < ${threshold}%)`,
      }
    }
  }

  // Lead-time check.
  const today = new Date().toISOString().slice(0, 10)
  const daysUntilEnd = daysBetween(today, c.end_date)
  const leadDays = Number(t.auto_generate_lead_days ?? 14)
  if (!options.force && daysUntilEnd < leadDays) {
    return {
      action: 'deferred',
      reason: `insufficient_lead_time (${daysUntilEnd} days, need ${leadDays})`,
    }
  }

  // Compute next cycle date range.
  const nextStart = addDaysIso(c.end_date, 1)
  const nextCycleNumber = Number(c.cycle_number) + 1

  // Generate the new cycle (uses Phase 4d's generator; applies latest
  // template since the template may have been edited since cycle 1).
  const result = await generateCycleInstance(
    db,
    c.template_id,
    nextStart,
    nextCycleNumber,
    { applyTemplateChanges: true }
  )

  // Run preflight on the freshly-generated cycle and persist results.
  const preflight = await runPreflightChecks(db, result.cycle_instance_id)
  await persistPreflightResults(db, result.cycle_instance_id, c.template_id, preflight)

  // Link cycles.
  await db
    .from('cycle_instances')
    .update({
      next_cycle_id: result.cycle_instance_id,
      auto_generation_triggered_at: new Date().toISOString(),
    })
    .eq('id', cycleId)

  return {
    action: 'triggered',
    new_cycle_id: result.cycle_instance_id,
    preflight_summary: {
      blocking: preflight.blocking.length,
      warning: preflight.warnings.length,
      info: preflight.info.length,
    },
  }
}
