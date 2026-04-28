import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const { id } = req.query
  const db = createAdminClient()

  const { data: memberships, error } = await db
    .from('portfolio_locations')
    .select('property_id')
    .eq('portfolio_id', id)

  if (error) return res.status(500).json({ error: error.message })
  const propertyIds = memberships?.map((m: any) => m.property_id) ?? []
  if (!propertyIds.length) return res.status(200).json({ properties: [] })

  const { data: properties } = await db
    .from('properties')
    .select('*, service_locations(*)')
    .in('property_id', propertyIds)

  return res.status(200).json({ properties: properties ?? [] })
}
