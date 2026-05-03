// POST /api/v1/schedule-assessments/[id]/save-as-template
//
// Promotes the operator's hybrid choices into a real routing_template.
// Body: { name, regenerate?: boolean }.
//
// What gets included:
//   - SLs whose operator choice is 'current' or 'optimized' (or unset
//     — default behavior is "include")
//   - SLs whose choice is 'skip' are excluded from routed_service_location_ids
//
// Other settings (branches, crew_count, cycle config, etc.) copy from
// the baseline template. The new template lives alongside the baseline
// and the user can iterate from there via the normal template UI.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest, type AuthContext } from '../../../_lib/auth.js'

export const config = { maxDuration: 300 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  let ctx: AuthContext
  try { ctx = await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const id = req.query.id as string
  const body = (req.body ?? {}) as { name?: string; regenerate?: boolean }
  const name = (body.name ?? '').trim()
  if (!name) return res.status(400).json({ error: 'name required' })
  const db = createAdminClient()

  const { data: assessment } = await db
    .from('schedule_assessments')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (!assessment) return res.status(404).json({ error: 'Assessment not found' })
  const a = assessment as any
  if (!a.baseline_template_id) {
    return res.status(400).json({ error: 'No baseline_template_id — pick a template first.' })
  }

  // Fetch baseline template to copy branches / crew_count / config.
  const { data: baseline } = await db
    .from('routing_templates')
    .select('*')
    .eq('id', a.baseline_template_id)
    .maybeSingle()
  if (!baseline) return res.status(404).json({ error: 'Baseline template not found' })
  const b = baseline as any

  // Collect SLs to include. Skip rows where operator chose 'skip'.
  const overrides = (a.hybrid_overrides ?? {}) as Record<string, { source?: string }>
  const PAGE = 1000
  const matched: any[] = []
  for (let p = 0; p < 50; p++) {
    const { data } = await db
      .from('schedule_assessment_rows')
      .select('id, matched_service_location_id, match_status')
      .eq('assessment_id', id)
      .in('match_status', ['auto', 'manual'])
      .not('matched_service_location_id', 'is', null)
      .range(p * PAGE, p * PAGE + PAGE - 1)
    const arr = data ?? []
    matched.push(...arr)
    if (arr.length < PAGE) break
  }
  // Build per-SL skip set: if any of the operator's choices for this
  // SL are 'skip' AND none are 'current'/'optimized', the SL is dropped
  // from the new template.
  const slIndexCounter = new Map<string, number>()
  const skipBySl = new Map<string, boolean>()
  for (const r of matched) {
    const sl = r.matched_service_location_id as string
    const idx = slIndexCounter.get(sl) ?? 0
    slIndexCounter.set(sl, idx + 1)
    const choice = overrides[`${sl}|${idx}`]?.source
    if (choice === 'skip') {
      // Mark unless we've already seen a non-skip choice for this SL.
      if (!skipBySl.has(sl)) skipBySl.set(sl, true)
    } else if (choice === 'current' || choice === 'optimized') {
      skipBySl.set(sl, false)
    }
  }
  // Also include SLs from the baseline template that aren't in the
  // assessment at all — those are "only_optimized" and unless the
  // operator explicitly skipped them via the diff (which we don't
  // track separately), they belong in the new template.
  const baselineSls = (b.routed_service_location_ids ?? []) as string[]
  const finalSls = new Set<string>()
  for (const slId of baselineSls) {
    // Default include — operator can iterate on the new template.
    if (skipBySl.get(slId) !== true) finalSls.add(slId)
  }
  for (const sl of slIndexCounter.keys()) {
    if (skipBySl.get(sl) !== true) finalSls.add(sl)
  }
  if (finalSls.size === 0) {
    return res.status(400).json({ error: 'No SLs to include — every row was skipped.' })
  }

  // Insert new template row, copying branches + crew_count + config
  // from the baseline. Status starts at 'optimizing'; if regenerate is
  // requested, we kick off the regenerate API to actually run the
  // engine.
  const { data: newTpl, error: insertErr } = await db
    .from('routing_templates')
    .insert({
      account_id: b.account_id,
      client_id: b.client_id,
      name,
      description: `Hybrid from assessment "${a.name}" (${a.id.slice(0, 8)})`,
      routed_service_location_ids: Array.from(finalSls),
      crew_count: b.crew_count,
      branches: b.branches,
      combined_client_ids: b.combined_client_ids ?? null,
      config: b.config ?? null,
      planning_mode: b.planning_mode ?? 'auto',
      cycle_length_days: b.cycle_length_days ?? 0,
      cycle_length_label: b.cycle_length_label ?? 'pending',
      is_custom_cycle_length: b.is_custom_cycle_length ?? false,
      status: 'pending',
      created_by: ctx.email ?? ctx.userId ?? null,
    })
    .select('id')
    .single()
  if (insertErr || !newTpl) {
    return res.status(500).json({ error: `template insert: ${insertErr?.message ?? 'unknown'}` })
  }
  const newTplId = (newTpl as any).id

  // Update the assessment with the new template id + finalize status.
  await db
    .from('schedule_assessments')
    .update({
      status: 'finalized',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  // Optional: regenerate immediately so the user sees the engine's
  // output for the new template.
  if (body.regenerate) {
    const baseUrl = `${req.headers['x-forwarded-proto'] ?? 'https'}://${req.headers.host}`
    const auth = req.headers.authorization ?? ''
    const r = await fetch(
      `${baseUrl}/api/scheduler/templates/${newTplId}/regenerate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify({}),
      }
    )
    if (!r.ok) {
      // Non-fatal — the template is created; user can manually trigger
      // regenerate from the template detail page.
      // eslint-disable-next-line no-console
      console.warn(`auto-regenerate failed: HTTP ${r.status}`)
    }
  }

  return res.status(201).json({
    template_id: newTplId,
    sl_count: finalSls.size,
    skipped_count: Array.from(skipBySl.entries()).filter(([, v]) => v).length,
  })
}
