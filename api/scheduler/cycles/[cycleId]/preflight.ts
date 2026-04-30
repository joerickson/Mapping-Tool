// GET  /api/scheduler/cycles/[cycleId]/preflight    — list current
//      (un-)acknowledged issues for the cycle
// POST /api/scheduler/cycles/[cycleId]/preflight    — re-run all checks
//      and persist results
//
// Phase 4e — preflight checks for an auto-generated (or manually
// re-generated) cycle.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import {
  runPreflightChecks,
  persistPreflightResults,
} from '../../../_lib/scheduler/preflight-checks.js'

export const config = { maxDuration: 60 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const cycleId = req.query.cycleId as string
  if (!cycleId) return res.status(400).json({ error: 'cycleId required' })
  const db = createAdminClient()

  try {
    if (req.method === 'GET') {
      const { data, error } = await db
        .from('cycle_preflight_checks')
        .select('*')
        .eq('cycle_instance_id', cycleId)
        .order('created_at', { ascending: false })
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ issues: data ?? [] })
    }
    if (req.method === 'POST') {
      // Need template_id from cycle_instances for persistence.
      const { data: cycle } = await db
        .from('cycle_instances')
        .select('template_id')
        .eq('id', cycleId)
        .single()
      if (!cycle) return res.status(404).json({ error: 'Cycle not found' })
      const result = await runPreflightChecks(db, cycleId)
      await persistPreflightResults(db, cycleId, (cycle as any).template_id, result)
      return res.status(200).json({
        has_blocking_issues: result.has_blocking_issues,
        blocking_count: result.blocking.length,
        warning_count: result.warnings.length,
        info_count: result.info.length,
      })
    }
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? String(err) })
  }
}
