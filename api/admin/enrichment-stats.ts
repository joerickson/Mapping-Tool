import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../_lib/supabase.js'
import { authenticateRequest } from '../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err) {
    const e = err as { statusCode?: number; message?: string }
    return res.status(e.statusCode ?? 401).json({ error: e.message ?? 'Unauthorized' })
  }

  const db = createAdminClient()

  const { data, error } = await db.from('properties').select('enrichment_status')

  if (error) return res.status(500).json({ error: error.message })

  const counts: Record<string, number> = { pending: 0, enriched: 0, failed: 0, total: 0 }
  for (const p of data ?? []) {
    counts.total++
    const status = p.enrichment_status as string
    counts[status] = (counts[status] ?? 0) + 1
  }

  return res.status(200).json(counts)
}
