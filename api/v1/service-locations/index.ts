import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase'
import { verifyAuth, unauthorized } from '../../_lib/auth'
import { fireWebhook } from '../../_lib/webhooks'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  const auth = await verifyAuth(req)
  if (!auth.ok) return unauthorized(res, auth.error)

  const db = createAdminClient()

  if (req.method === 'GET') {
    const { client_id, property_id, limit = '500', offset = '0' } = req.query

    let query = db
      .from('service_locations')
      .select('*, property:properties(*)')
      .range(Number(offset), Number(offset) + Number(limit) - 1)
      .order('created_at', { ascending: false })

    if (client_id) {
      const ids = String(client_id).split(',')
      query = query.in('client_id', ids)
    }

    if (property_id) {
      query = query.eq('property_id', property_id)
    }

    const { data, error, count } = await query
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ service_locations: data ?? [], total: count ?? 0 })
  }

  if (req.method === 'POST') {
    const { property_id, ...rest } = req.body ?? {}
    if (!property_id) return res.status(400).json({ error: 'property_id required' })

    const { data, error } = await db
      .from('service_locations')
      .insert({ property_id, status: 'active', ...rest })
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })

    await fireWebhook('service_location.created', {
      service_location_id: data.service_location_id,
      property_id,
      client_id: data.client_id,
    })

    return res.status(201).json(data)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
