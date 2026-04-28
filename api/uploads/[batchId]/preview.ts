import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'

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

  const { data: batch, error } = await db
    .from('upload_batches')
    .select('upload_batch_id, source_filename, filename, detected_format, sheets, total_rows, row_count, status')
    .eq('upload_batch_id', batchId)
    .single()

  if (error || !batch) return res.status(404).json({ error: 'Batch not found' })

  return res.status(200).json({
    batch_id: batch.upload_batch_id,
    source_filename: batch.source_filename ?? batch.filename,
    detected_format: batch.detected_format,
    sheets: batch.sheets ?? [],
    total_rows: batch.total_rows ?? batch.row_count ?? 0,
    status: batch.status,
  })
}
