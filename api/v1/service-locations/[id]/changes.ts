import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase'
import { verifyAuth, unauthorized } from '../../../_lib/auth'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await verifyAuth(req)
  if (!auth.ok) return unauthorized(res, auth.error)

  const { id } = req.query
  const db = createAdminClient()

  const { data: loc } = await db
    .from('service_locations')
    .select('property_id')
    .eq('service_location_id', id)
    .single()

  if (!loc) return res.status(404).json({ error: 'Not found' })

  const { data, error } = await db
    .from('property_changes')
    .select('*')
    .eq('property_id', loc.property_id)
    .order('changed_at', { ascending: false })
    .limit(50)

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json(data ?? [])
}
