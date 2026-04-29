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
      .eq('id', id)
      .single()

    if (error || !data) return res.status(404).json({ error: 'Not found' })

    // Alias real PKs (id) to legacy field names for frontend compatibility.
    const sl: any = data
    const aliasedSl = { ...sl, service_location_id: sl.id }
    const aliasedProperty = sl.property
      ? { ...sl.property, property_id: sl.property.id }
      : null
    return res.status(200).json({ service_location: aliasedSl, property: aliasedProperty })
  }

  if (req.method === 'PATCH') {
    const updates = req.body ?? {}
    const oldStatus = updates.status
      ? (
          await db
            .from('service_locations')
            .select('status')
            .eq('id', id)
            .single()
        ).data?.status
      : undefined

    const { data, error } = await db
      .from('service_locations')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
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

    const aliasedSl = data ? { ...(data as any), service_location_id: (data as any).id } : data
    return res.status(200).json({ service_location: aliasedSl })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
