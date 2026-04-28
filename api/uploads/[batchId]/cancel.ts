import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string }
    return res.status(e.statusCode ?? 401).json({ error: e.message ?? 'Unauthorized' })
  }

  const batchId = req.query.batchId as string
  const db = createAdminClient()

  const { data: batch, error: fetchErr } = await db
    .from('upload_batches')
    .select('upload_batch_id, status')
    .eq('upload_batch_id', batchId)
    .single()

  if (fetchErr || !batch) return res.status(404).json({ error: 'Batch not found' })

  if (batch.status === 'committed') {
    return res.status(400).json({ error: 'Cannot cancel a committed batch' })
  }

  // Delete staged rows (they're cascade-deleted anyway, but be explicit)
  await db.from('upload_staged_rows').delete().eq('upload_batch_id', batchId)

  await db
    .from('upload_batches')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('upload_batch_id', batchId)

  return res.status(200).json({ batch_id: batchId, status: 'cancelled' })
}
