import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from './_lib/supabase'
import { verifyAuth, unauthorized } from './_lib/auth'
import { runScrubPipeline } from '../src/lib/scrub/pipeline'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await verifyAuth(req)
  if (!auth.ok) return unauthorized(res, auth.error)

  const { filename, rows, mapping } = req.body ?? {}
  if (!rows?.length || !mapping) return res.status(400).json({ error: 'rows and mapping required' })

  const db = createAdminClient()

  const { data: batch, error: batchErr } = await db
    .from('upload_batches')
    .insert({
      filename,
      row_count: rows.length,
      raw_data: rows,
      column_mapping: mapping,
      uploaded_by: auth.userId,
    })
    .select('upload_batch_id')
    .single()

  if (batchErr) return res.status(500).json({ error: batchErr.message })

  const batchId: string = batch.upload_batch_id

  // Stage 0: local scrub + dedup (always runs), + optional Google Address Validation
  let summary
  try {
    summary = await runScrubPipeline(batchId, rows, mapping, db, {
      googleAddressValidationKey: process.env.GOOGLE_ADDRESS_VALIDATION_KEY,
    })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Scrub pipeline failed' })
  }

  return res.status(200).json({ batchId, summary })
}
