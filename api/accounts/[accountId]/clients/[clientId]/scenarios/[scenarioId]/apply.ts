// POST /api/accounts/[accountId]/scenarios/[scenarioId]/apply
// Writes a saved scenario's overrides into account_operational_constraints,
// making them the new baseline. Two-step: first call without ?confirm=true
// returns the diff for the dashboard to show in a confirmation modal; second
// call with ?confirm=true (or { confirm: true } in body) actually upserts.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../../../../_lib/supabase.js'
import { authenticateRequest } from '../../../../../../_lib/auth.js'
import { loadConstraints } from '../../../../../../_lib/analysis/operational-constraints.js'
import { triggerSynthesisRefresh } from '../../../../../../_lib/synthesis-refresh.js'

const NUMERIC_KEYS = [
  'crew_size',
  'hours_per_day',
  'hourly_loaded_labor_cost',
  'project_clean_base_hours',
  'project_clean_hours_per_sqft',
  'upholstery_solo_hours',
  'upholstery_combo_hours_pct',
  'recurring_productivity_sqft_per_hour',
  'fuel_cost_per_mile',
  'vehicles_per_crew',
  'surge_weeks_per_year',
  'surge_crew_count',
  'surge_premium_multiplier',
  'branch_overhead_annual',
  'hotels_annual',
  'vehicle_lease_annual_per_crew',
  'supplies_pct_of_labor',
  'insurance_annual',
  'corporate_overhead_pct',
  'target_gross_margin_pct',
  'drive_speed_mph',
  'max_one_way_drive_minutes',
] as const

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let ctx: Awaited<ReturnType<typeof authenticateRequest>>
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const accountId = req.query.accountId as string
  const clientId = req.query.clientId as string
  const scenarioId = req.query.scenarioId as string
  const body = (req.body ?? {}) as { confirm?: boolean }
  const confirmed = body.confirm === true || req.query.confirm === 'true'
  const db = createAdminClient()

  const { data: scenario } = await db
    .from('analysis_scenarios')
    .select('id, name, overrides')
    .eq('id', scenarioId)
    .eq('account_id', accountId)
    .eq('client_id', clientId)
    .single()

  if (!scenario) return res.status(404).json({ error: 'Scenario not found' })

  const overrides = ((scenario as any).overrides ?? {}) as Record<string, unknown>
  const baseline = await loadConstraints(db, accountId, clientId)

  // Build the diff for the confirmation card
  const diff: Array<{ key: string; from: any; to: any }> = []
  for (const k of NUMERIC_KEYS) {
    if (k in overrides) {
      const to = overrides[k]
      const from = (baseline as any)[k]
      if (typeof to === 'number' && from !== to) diff.push({ key: k, from, to })
    }
  }

  if (!confirmed) {
    return res.status(200).json({
      confirmation_required: true,
      scenario_name: (scenario as any).name,
      diff,
      message: `This will overwrite ${diff.length} field${diff.length === 1 ? '' : 's'} on your operational constraints. Tier 2 analyses will be marked stale.`,
    })
  }

  if (diff.length === 0) {
    return res.status(200).json({ ok: true, message: 'No numeric changes to apply.', diff })
  }

  const upsert: Record<string, unknown> = {
    account_id: accountId,
    client_id: clientId,
    updated_at: new Date().toISOString(),
    updated_by: ctx.userId ?? null,
  }
  for (const d of diff) upsert[d.key] = d.to

  const { error } = await db
    .from('account_operational_constraints')
    .upsert(upsert, { onConflict: 'account_id,client_id' })

  if (error) return res.status(500).json({ error: error.message })

  await triggerSynthesisRefresh(db, accountId, clientId)
  return res.status(200).json({ ok: true, applied_count: diff.length, diff })
}
