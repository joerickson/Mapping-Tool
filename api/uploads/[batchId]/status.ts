import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase'
import { verifyAuth, unauthorized } from '../../_lib/auth'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await verifyAuth(req)
  if (!auth.ok) return unauthorized(res, auth.error)

  const batchId = req.query.batchId as string
  if (!batchId) return res.status(400).json({ error: 'batchId required' })

  const db = createAdminClient()

  const { data: batch, error } = await db
    .from('upload_batches')
    .select(
      'upload_batch_id, status, row_count, rows_processed, validation_errors_count, auto_corrections_count, completed_at, error_message',
    )
    .eq('upload_batch_id', batchId)
    .single()

  if (error || !batch) return res.status(404).json({ error: 'Batch not found' })

  const payload: Record<string, unknown> = {
    batchId: batch.upload_batch_id,
    status: batch.status ?? 'queued',
    total_rows: batch.row_count,
    rows_processed: batch.rows_processed ?? 0,
    validation_errors_count: batch.validation_errors_count ?? 0,
    auto_corrections_count: batch.auto_corrections_count ?? 0,
  }

  if (batch.error_message) {
    payload.error = batch.error_message
  }

  if (batch.status === 'completed') {
    const { data: staged } = await db
      .from('staged_addresses')
      .select('scrub_status')
      .eq('upload_batch_id', batchId)

    if (staged) {
      payload.summary = {
        total: staged.length,
        clean: staged.filter((r) => r.scrub_status === 'clean').length,
        auto_corrected: staged.filter((r) => r.scrub_status === 'auto_corrected').length,
        needs_review: staged.filter((r) => r.scrub_status === 'needs_review').length,
        duplicate: staged.filter((r) => r.scrub_status === 'duplicate').length,
        existing_property: staged.filter((r) => r.scrub_status === 'existing_property').length,
        rejected: staged.filter((r) => r.scrub_status === 'rejected').length,
      }
    }
  }

  return res.status(200).json(payload)
}
