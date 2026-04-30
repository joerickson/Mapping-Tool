// POST /api/scheduler/templates/[templateId]/generate-cycle
// Body: { start_date, cycle_number?, apply_template_changes?: boolean }
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import { generateCycleInstance } from '../../../_lib/scheduler/generate-cycle-instance.js'

export const config = { maxDuration: 300 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try { await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const templateId = req.query.templateId as string
  const body = (req.body ?? {}) as Record<string, unknown>
  const startDate = body.start_date as string | undefined
  const cycleNumber = (body.cycle_number as number | undefined) ?? null
  const applyChanges = body.apply_template_changes === true
  if (!startDate) return res.status(400).json({ error: 'start_date required (YYYY-MM-DD)' })

  const db = createAdminClient()

  // Auto-pick cycle number = max(existing) + 1 if not provided
  let resolvedCycleNumber = cycleNumber
  if (resolvedCycleNumber == null) {
    const { data: existing } = await db
      .from('cycle_instances')
      .select('cycle_number')
      .eq('template_id', templateId)
      .order('cycle_number', { ascending: false })
      .limit(1)
      .maybeSingle()
    resolvedCycleNumber = (existing as { cycle_number?: number } | null)?.cycle_number != null
      ? (existing as { cycle_number: number }).cycle_number + 1
      : 1
  }

  try {
    const result = await generateCycleInstance(db, templateId, startDate, resolvedCycleNumber, {
      applyTemplateChanges: applyChanges,
      skipExisting: !applyChanges,
    })
    return res.status(200).json(result)
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? String(err) })
  }
}
