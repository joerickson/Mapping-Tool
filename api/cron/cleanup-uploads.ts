import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../_lib/supabase.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  // Allow GET (Vercel cron) or POST
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Validate Vercel cron secret to prevent unauthorized calls
  const authHeader = req.headers['authorization']
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const db = createAdminClient()
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // Fetch old batches whose files should be purged
  const { data: oldBatches } = await db
    .from('upload_batches')
    .select('upload_batch_id, file_path')
    .lt('created_at', cutoff)
    .not('file_path', 'is', null)

  let deleted = 0
  let failed = 0

  if (oldBatches?.length) {
    for (const batch of oldBatches) {
      if (!batch.file_path) continue
      const { error } = await db.storage
        .from('upload-batches')
        .remove([batch.file_path as string])

      if (error) {
        failed++
      } else {
        // Clear file_path to mark as cleaned up
        await db
          .from('upload_batches')
          .update({ file_path: null })
          .eq('upload_batch_id', batch.upload_batch_id)
        deleted++
      }
    }
  }

  // Also clean up staged rows for old batches (belt + suspenders — CASCADE handles it, but force here)
  const { data: oldCommitted } = await db
    .from('upload_batches')
    .select('upload_batch_id')
    .lt('created_at', cutoff)
    .in('status', ['committed', 'cancelled', 'expired'])

  let stagedCleaned = 0
  if (oldCommitted?.length) {
    for (const b of oldCommitted) {
      const { error } = await db
        .from('upload_staged_rows')
        .delete()
        .eq('upload_batch_id', b.upload_batch_id)
      if (!error) stagedCleaned++
    }
  }

  return res.status(200).json({
    storage_files_deleted: deleted,
    storage_deletes_failed: failed,
    staged_batches_cleaned: stagedCleaned,
    cutoff,
  })
}
