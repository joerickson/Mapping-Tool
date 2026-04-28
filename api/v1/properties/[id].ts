import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'
import { fireWebhook } from '../../_lib/webhooks.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  let ctx: Awaited<ReturnType<typeof authenticateRequest>>
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const { id } = req.query
  const db = createAdminClient()

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('properties')
      .select(`
        *,
        service_locations(*),
        enrichment_jobs(enrichment_job_id, status, completed_at, created_at)
      `)
      .eq('property_id', id)
      .single()

    if (error || !data) return res.status(404).json({ error: 'Not found' })
    return res.status(200).json(data)
  }

  if (req.method === 'PATCH') {
    const updates = req.body ?? {}
    const changedFields = Object.keys(updates)

    if (changedFields.includes('rbm_category')) {
      const { data: current } = await db
        .from('properties')
        .select('rbm_category')
        .eq('property_id', id)
        .single()

      await db.from('property_changes').insert({
        property_id: id,
        field_name: 'rbm_category',
        old_value: current?.rbm_category,
        new_value: updates.rbm_category,
        changed_by: ctx.userId,
        changed_at: new Date().toISOString(),
      })
    }

    const { data, error } = await db
      .from('properties')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('property_id', id)
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })

    await fireWebhook('property.updated', {
      property_id: id,
      changed_fields: changedFields,
      changed_by: ctx.userId ?? 'service',
    })

    return res.status(200).json({ property: data })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
