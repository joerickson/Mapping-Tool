import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase'
import { verifyAuth, unauthorized } from '../../_lib/auth'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await verifyAuth(req)
  if (!auth.ok) return unauthorized(res, auth.error)

  const db = createAdminClient()

  // Try clients table first; fall back to distinct client_ids from service_locations
  const { data: clients, error } = await db
    .from('clients')
    .select('client_id, name')
    .order('name')

  if (!error && clients) return res.status(200).json(clients)

  // Fallback: distinct client_ids from service_locations
  const { data: locs } = await db
    .from('service_locations')
    .select('client_id')
    .not('client_id', 'is', null)

  const unique = Array.from(new Set(locs?.map((l: any) => l.client_id) ?? []))
  return res.status(200).json(unique.map((id) => ({ client_id: id, name: id })))
}
