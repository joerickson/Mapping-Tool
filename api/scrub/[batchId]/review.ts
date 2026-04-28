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

  const { data: rows, error } = await db
    .from('staged_addresses')
    .select('*')
    .eq('upload_batch_id', batchId)
    .order('row_index', { ascending: true })

  if (error) return res.status(500).json({ error: error.message })
  if (!rows) return res.status(404).json({ error: 'Batch not found' })

  const summary = {
    total: rows.length,
    clean: rows.filter((r) => r.scrub_status === 'clean').length,
    auto_corrected: rows.filter((r) => r.scrub_status === 'auto_corrected').length,
    needs_review: rows.filter((r) => r.scrub_status === 'needs_review').length,
    duplicate: rows.filter((r) => r.scrub_status === 'duplicate').length,
    existing_property: rows.filter((r) => r.scrub_status === 'existing_property').length,
    rejected: rows.filter((r) => r.scrub_status === 'rejected').length,
  }

  return res.status(200).json({ summary, rows })
}
