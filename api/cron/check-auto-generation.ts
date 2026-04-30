// Vercel cron entrypoint: runs auto-generation check on every
// in-progress cycle once per day. Schedule lives in vercel.json.
//
// Auth: Vercel cron service injects Authorization: Bearer <CRON_SECRET>
// where CRON_SECRET is an env var on the project.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../_lib/supabase.js'
import { checkAndTriggerAutoGeneration } from '../_lib/scheduler/auto-generation.js'

export const config = { maxDuration: 300 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel Cron uses GET; allow POST too for manual smoke tests.
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const expected = process.env.CRON_SECRET
  if (expected) {
    const provided = req.headers.authorization ?? ''
    if (provided !== `Bearer ${expected}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  const db = createAdminClient()
  const { data: rows, error } = await db
    .from('cycle_instances')
    .select('id, status, next_cycle_id')
    .eq('status', 'in_progress')
    .is('next_cycle_id', null)
  if (error) return res.status(500).json({ error: error.message })

  const results: Array<{ cycle_id: string; action: string; reason?: string }> = []
  for (const row of (rows ?? []) as Array<{ id: string }>) {
    try {
      const outcome = await checkAndTriggerAutoGeneration(db, row.id)
      results.push({
        cycle_id: row.id,
        action: outcome.action,
        reason: outcome.reason,
      })
    } catch (err: any) {
      results.push({
        cycle_id: row.id,
        action: 'error',
        reason: err?.message ?? String(err),
      })
    }
  }
  return res.status(200).json({
    checked: rows?.length ?? 0,
    triggered: results.filter((r) => r.action === 'triggered').length,
    deferred: results.filter((r) => r.action === 'deferred').length,
    skipped: results.filter((r) => r.action === 'skipped').length,
    errors: results.filter((r) => r.action === 'error').length,
    results,
  })
}
