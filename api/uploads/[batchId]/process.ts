import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { verifyAuth, unauthorized } from '../../_lib/auth.js'
import { runScrubPipeline } from '../../../src/lib/scrub/pipeline.js'

const CHUNK_SIZE = 100

export const config = { maxDuration: 300 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await verifyAuth(req)
  if (!auth.ok) return unauthorized(res, auth.error)

  const batchId = req.query.batchId as string
  if (!batchId) return res.status(400).json({ error: 'batchId required' })

  const db = createAdminClient()

  const { data: batch, error: fetchErr } = await db
    .from('upload_batches')
    .select('upload_batch_id, status, row_count, raw_data, column_mapping')
    .eq('upload_batch_id', batchId)
    .single()

  if (fetchErr || !batch) return res.status(404).json({ error: 'Batch not found' })

  if (batch.status === 'completed' || batch.status === 'failed') {
    return res.status(200).json({ batchId, status: batch.status })
  }
  if (batch.status === 'processing') {
    return res.status(200).json({ batchId, status: 'processing', message: 'Already processing' })
  }

  await db
    .from('upload_batches')
    .update({ status: 'processing', processing_started_at: new Date().toISOString() })
    .eq('upload_batch_id', batchId)

  try {
    const rows = batch.raw_data as Record<string, unknown>[]
    const mapping = batch.column_mapping as Parameters<typeof runScrubPipeline>[2]
    const total = rows.length

    for (let i = 0; i < total; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE)
      await runScrubPipeline(batchId, chunk, mapping, db, {
        googleAddressValidationKey: process.env.GOOGLE_ADDRESS_VALIDATION_KEY,
        rowOffset: i,
      })

      await db
        .from('upload_batches')
        .update({ rows_processed: Math.min(i + CHUNK_SIZE, total) })
        .eq('upload_batch_id', batchId)
    }

    // Compute final counts from staged_addresses (source of truth)
    const { data: staged } = await db
      .from('staged_addresses')
      .select('scrub_status')
      .eq('upload_batch_id', batchId)

    const statuses = staged?.map((r) => r.scrub_status) ?? []
    const validationErrors = statuses.filter((s) => s === 'needs_review').length
    const autoCorrections = statuses.filter((s) => s === 'auto_corrected').length

    await db
      .from('upload_batches')
      .update({
        status: 'completed',
        rows_processed: total,
        validation_errors_count: validationErrors,
        auto_corrections_count: autoCorrections,
        completed_at: new Date().toISOString(),
      })
      .eq('upload_batch_id', batchId)

    return res.status(200).json({
      batchId,
      status: 'completed',
      total_rows: total,
      rows_processed: total,
      validation_errors_count: validationErrors,
      auto_corrections_count: autoCorrections,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Processing failed'
    await db
      .from('upload_batches')
      .update({ status: 'failed', error_message: msg })
      .eq('upload_batch_id', batchId)
    return res.status(500).json({ error: msg })
  }
}
