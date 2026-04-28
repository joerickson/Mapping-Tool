import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const id = req.query.id as string
  const db = createAdminClient()

  if (req.method === 'GET') {
    const { data, error } = await db.from('service_offerings').select('*').eq('id', id).single()
    if (error || !data) return res.status(404).json({ error: 'Not found' })
    return res.status(200).json(data)
  }

  if (req.method === 'PATCH') {
    const allowed = [
      'name', 'display_name', 'description', 'pricing_model',
      'default_frequency_label', 'default_visits_per_year', 'default_hours_per_visit',
      'default_crew_size', 'is_archived', 'account_id', 'client_id', 'metadata',
    ]
    const patch: Record<string, unknown> = {}
    for (const key of allowed) {
      if (key in (req.body ?? {})) patch[key] = req.body[key]
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'No fields to update' })

    const { data, error } = await db
      .from('service_offerings')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data)
  }

  if (req.method === 'DELETE') {
    const { error } = await db.from('service_offerings').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(204).end()
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
