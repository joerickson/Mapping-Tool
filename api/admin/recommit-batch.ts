import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../_lib/supabase.js'
import { authenticateRequest } from '../_lib/auth.js'

export const config = { maxDuration: 300 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string }
    return res.status(e.statusCode ?? 401).json({ error: e.message ?? 'Unauthorized' })
  }

  const { batch_id } = req.body
  if (!batch_id) return res.status(400).json({ error: 'batch_id required' })

  const db = createAdminClient()

  // Reset batch state so commit endpoint accepts it
  const { error: resetErr } = await db
    .from('upload_batches')
    .update({
      status: 'completed',
      committed_at: null,
    })
    .eq('upload_batch_id', batch_id)

  if (resetErr) return res.status(500).json({ error: `Reset failed: ${resetErr.message}` })

  // Forward to the existing commit endpoint
  const commitUrl = `${process.env.VITE_APP_URL || 'https://propertyintel.dev'}/api/uploads/${batch_id}/commit`
  const commitResp = await fetch(commitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-RBM-Service-Key': process.env.SERVICE_API_KEY ?? '',
    },
  })

  const commitData = await commitResp.json()
  return res.status(commitResp.status).json(commitData)
}
