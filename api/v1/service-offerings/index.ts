import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  let ctx: Awaited<ReturnType<typeof authenticateRequest>>
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const db = createAdminClient()

  if (req.method === 'GET') {
    const { account_id, client_id, include_archived, include_related } = req.query

    // include_related=true: return global + account-level + client-level in one query
    if (include_related === 'true' && account_id) {
      const aid = String(account_id)
      const cid = client_id ? String(client_id) : null
      let query = db
        .from('service_offerings')
        .select('*')
        .or(
          cid
            ? `and(account_id.is.null,client_id.is.null),and(account_id.eq.${aid},client_id.is.null),and(account_id.eq.${aid},client_id.eq.${cid})`
            : `and(account_id.is.null,client_id.is.null),and(account_id.eq.${aid},client_id.is.null)`
        )
        .order('name', { ascending: true })
      if (include_archived !== 'true') query = query.eq('is_archived', false)
      const { data, error } = await query
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json(data ?? [])
    }

    let query = db.from('service_offerings').select('*').order('name', { ascending: true })
    if (account_id) query = query.eq('account_id', String(account_id))
    if (client_id) query = query.eq('client_id', String(client_id))
    if (include_archived !== 'true') query = query.eq('is_archived', false)
    const { data, error } = await query
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data ?? [])
  }

  if (req.method === 'POST') {
    const {
      name, display_name, description, pricing_model = 'custom',
      default_frequency_label, default_visits_per_year, default_hours_per_visit,
      default_crew_size, account_id, client_id, metadata,
    } = req.body ?? {}

    if (!name?.trim()) return res.status(400).json({ error: 'name is required' })
    const validModels = ['fixed_per_visit', 'monthly_recurring', 'hourly', 'per_sqft', 'custom']
    if (!validModels.includes(pricing_model)) {
      return res.status(400).json({ error: `pricing_model must be one of: ${validModels.join(', ')}` })
    }

    const { data, error } = await db
      .from('service_offerings')
      .insert({
        name: name.trim(),
        display_name: display_name?.trim() ?? null,
        description: description ?? null,
        pricing_model,
        default_frequency_label: default_frequency_label ?? null,
        default_visits_per_year: default_visits_per_year ?? null,
        default_hours_per_visit: default_hours_per_visit ?? null,
        default_crew_size: default_crew_size ?? null,
        account_id: account_id ?? null,
        client_id: client_id ?? null,
        metadata: metadata ?? {},
        created_by: ctx.userId ?? null,
      })
      .select('*')
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(201).json(data)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
