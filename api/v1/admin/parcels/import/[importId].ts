/**
 * GET /api/v1/admin/parcels/import/:importId
 * Returns the current status of an import job (for live polling).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../../_lib/supabase'
import { authenticateRequest } from '../../../../_lib/auth'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  let ctx
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  if (ctx.mode !== 'user') return res.status(403).json({ error: 'Forbidden' })

  const importId = req.query.importId as string
  const db = createAdminClient()

  const { data, error } = await db
    .from('parcel_county_imports')
    .select('*')
    .eq('id', importId)
    .single()

  if (error || !data) return res.status(404).json({ error: 'Import not found' })

  return res.status(200).json(data)
}
