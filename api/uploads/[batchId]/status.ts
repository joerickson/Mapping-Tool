import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'

interface UploadBatchRow {
  upload_batch_id: string
  status: string | null
  total_rows: number | null
  row_count: number | null
  rows_processed: number | null
  errors_count: number | null
  validation_errors_count: number | null
  auto_corrections_count: number | null
  current_sheet: string | null
  summary_stats: Record<string, unknown> | null
  completed_at: string | null
  committed_at: string | null
  cancelled_at: string | null
  error_message: string | null
  sheets: unknown
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string }
    return res.status(e.statusCode ?? 401).json({ error: e.message ?? 'Unauthorized' })
  }

  const batchId = req.query.batchId as string
  const db = createAdminClient()

  const { data: batchRaw, error } = await db
    .from('upload_batches')
    .select(
      'upload_batch_id, status, total_rows, row_count, rows_processed, errors_count, ' +
      'validation_errors_count, auto_corrections_count, current_sheet, summary_stats, ' +
      'completed_at, committed_at, cancelled_at, error_message, sheets'
    )
    .eq('upload_batch_id', batchId)
    .single()

  if (error || !batchRaw) return res.status(404).json({ error: 'Batch not found' })
  const batch = batchRaw as unknown as UploadBatchRow

  const totalRows = (batch.total_rows ?? batch.row_count ?? 0) as number

  const payload: Record<string, unknown> = {
    batch_id: batch.upload_batch_id,
    status: batch.status ?? 'queued',
    total_rows: totalRows,
    rows_processed: batch.rows_processed ?? 0,
    errors_count: batch.errors_count ?? batch.validation_errors_count ?? 0,
    auto_corrections_count: batch.auto_corrections_count ?? 0,
    current_sheet: batch.current_sheet ?? null,
  }

  if (batch.error_message) payload.error = batch.error_message

  // New-style batch: has summary_stats from Edge Function
  if (batch.summary_stats) {
    payload.summary_stats = batch.summary_stats
  } else if (batch.status === 'completed') {
    // Legacy: derive summary from staged_addresses
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
