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
    const { account_id, client_id, include_values } = req.query
    let query = db.from('custom_field_definitions').select('*').order('sort_order', { ascending: true })
    if (account_id) query = query.eq('account_id', String(account_id))
    if (client_id) query = query.eq('client_id', String(client_id))
    const { data, error } = await query
    if (error) return res.status(500).json({ error: error.message })
    const defs = (data ?? []) as any[]

    // When include_values=true and a client_id is provided, scan the
    // client's service_locations.custom_fields and attach the distinct
    // values per field. Operators want these as a dropdown rather than
    // a free-form contains-match input — picking from real values is
    // less error-prone than guessing what was imported.
    if (include_values === 'true' && client_id && defs.length > 0) {
      const SL_PAGE = 1000
      const SL_MAX_PAGES = 50
      const valuesByKey = new Map<string, Set<string>>()
      for (const d of defs) valuesByKey.set(d.field_key, new Set())
      for (let page = 0; page < SL_MAX_PAGES; page++) {
        const from = page * SL_PAGE
        const { data: slRows, error: slErr } = await db
          .from('service_locations')
          .select('custom_fields')
          .eq('client_id', String(client_id))
          .range(from, from + SL_PAGE - 1)
        if (slErr) return res.status(500).json({ error: slErr.message })
        const batch = (slRows ?? []) as Array<{ custom_fields: Record<string, unknown> | null }>
        for (const r of batch) {
          const cf = r.custom_fields ?? {}
          for (const d of defs) {
            const v = cf[d.field_key]
            if (v == null) continue
            const s = String(v).trim()
            if (s.length === 0) continue
            valuesByKey.get(d.field_key)?.add(s)
          }
        }
        if (batch.length < SL_PAGE) break
      }
      for (const d of defs) {
        const set = valuesByKey.get(d.field_key)
        d.distinct_values = set ? Array.from(set).sort((a, b) => a.localeCompare(b)) : []
      }
    }

    return res.status(200).json(defs)
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
