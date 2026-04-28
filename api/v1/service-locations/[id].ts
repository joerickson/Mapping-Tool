import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'
import { fireWebhook } from '../../_lib/webhooks.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const { id } = req.query
  const db = createAdminClient()

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('service_locations')
      .select('*, property:properties(*)')
      .eq('service_location_id', id)
      .single()

    if (error || !data) return res.status(404).json({ error: 'Not found' })
    return res.status(200).json({ service_location: data, property: data.property })
  }

  if (req.method === 'PATCH') {
    const updates = req.body ?? {}
    const oldStatus = updates.status
      ? (
          await db
            .from('service_locations')
            .select('status')
            .eq('service_location_id', id)
            .single()
        ).data?.status
      : undefined

    const { data, error } = await db
      .from('service_locations')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('service_location_id', id)
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })

    if (updates.status && oldStatus && updates.status !== oldStatus) {
      await fireWebhook('service_location.status_changed', {
        service_location_id: id,
        old_status: oldStatus,
        new_status: updates.status,
      })
    }

    return res.status(200).json({ service_location: data })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
