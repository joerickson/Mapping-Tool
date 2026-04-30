// POST /api/scheduler/visits/[visitId]/unlock
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import { unlockVisit } from '../../../_lib/scheduler/edit-propagation.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try { await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const visitId = req.query.visitId as string
  const db = createAdminClient()
  await unlockVisit(db, visitId)
  return res.status(200).json({ ok: true })
}
