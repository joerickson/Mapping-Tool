// POST /api/uploads/[batchId]/ignore-failed
// Marks the staged rows that failed to commit (or have never been
// committed despite being eligible) as 'manually_ignored' so the batch
// is no longer flagged as pending. The rows stay in the DB for audit
// but won't be re-attempted by future retries and won't count toward
// "valid_count" in the pending-uploads banner.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const batchId = req.query.batchId as string
  if (!batchId) return res.status(400).json({ error: 'batchId required' })

  const db = createAdminClient()

  const { data: batch, error: bErr } = await db
    .from('upload_batches')
    .select('upload_batch_id, status, summary_stats')
    .eq('upload_batch_id', batchId)
    .single()
  if (bErr || !batch) return res.status(404).json({ error: 'Batch not found' })

  // Find staged rows that are still committable but have no
  // service_location_id — those are the rows that failed to commit
  // (or that the loop never reached). Mark them invalid so the
  // pending-uploads banner stops counting them.
  const { data: stuck, error: sErr } = await db
    .from('upload_staged_rows')
    .select('id')
    .eq('upload_batch_id', batchId)
    .in('outcome', ['valid', 'corrected', 'duplicate_existing'])
    .is('service_location_id', null)
  if (sErr) return res.status(500).json({ error: sErr.message })

  const stuckIds = (stuck ?? []).map((r: any) => r.id as string)
  if (stuckIds.length === 0) {
    return res.status(200).json({ ignored: 0, message: 'Nothing to ignore' })
  }

  const { error: uErr } = await db
    .from('upload_staged_rows')
    .update({
      outcome: 'invalid',
      error_messages: ['Manually ignored by user'],
    })
    .in('id', stuckIds)
  if (uErr) return res.status(500).json({ error: uErr.message })

  // Stamp the batch summary so the UI reflects the action.
  const prior = (batch.summary_stats as Record<string, any>) ?? {}
  await db
    .from('upload_batches')
    .update({
      summary_stats: {
        ...prior,
        manually_ignored_count: (Number(prior.manually_ignored_count) || 0) + stuckIds.length,
        commit_failure_count: 0,
        commit_failures: [],
      },
    })
    .eq('upload_batch_id', batchId)

  return res.status(200).json({ ignored: stuckIds.length })
}
