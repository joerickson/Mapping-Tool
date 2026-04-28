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
    const { account_id, client_id } = req.query
    let query = db.from('custom_field_definitions').select('*').order('sort_order', { ascending: true })
    if (account_id) query = query.eq('account_id', String(account_id))
    if (client_id) query = query.eq('client_id', String(client_id))
    const { data, error } = await query
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data ?? [])
  }

  if (req.method === 'POST') {
    const {
      field_key, field_label, field_type, select_options,
      account_id, client_id, appears_in_filters = true, appears_in_groups = true, sort_order = 0,
    } = req.body ?? {}

    if (!field_key?.trim()) return res.status(400).json({ error: 'field_key is required' })
    if (!field_label?.trim()) return res.status(400).json({ error: 'field_label is required' })
    const validTypes = ['text', 'number', 'date', 'select']
    if (!validTypes.includes(field_type)) {
      return res.status(400).json({ error: `field_type must be one of: ${validTypes.join(', ')}` })
    }

    const { data, error } = await db
      .from('custom_field_definitions')
      .insert({
        field_key: field_key.trim(),
        field_label: field_label.trim(),
        field_type,
        select_options: select_options ?? null,
        account_id: account_id ?? null,
        client_id: client_id ?? null,
        appears_in_filters,
        appears_in_groups,
        sort_order,
      })
      .select('*')
      .single()

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'A field with this key already exists' })
      return res.status(500).json({ error: error.message })
    }
    return res.status(201).json(data)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
