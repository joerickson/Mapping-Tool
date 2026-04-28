import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase'
import { authenticateRequest } from '../../_lib/auth'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  let ctx: Awaited<ReturnType<typeof authenticateRequest>>
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const db = createAdminClient()

  // ── GET /api/v1/clients ───────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { status, search } = req.query

    let query = db
      .from('clients')
      .select('*')
      .order('name', { ascending: true })

    if (status) query = query.eq('status', String(status))
    if (search) query = query.ilike('name', `%${String(search)}%`)

    const { data, error } = await query
    if (error) return res.status(500).json({ error: error.message })

    return res.status(200).json(data ?? [])
  }

  // ── POST /api/v1/clients ──────────────────────────────────────────────────
  if (req.method === 'POST') {
    const {
      name,
      display_name,
      status = 'active',
      notes,
      primary_contact_name,
      primary_contact_email,
      primary_contact_phone,
      brand_color,
      logo_url,
      metadata,
    } = req.body ?? {}

    if (!name?.trim()) return res.status(400).json({ error: 'name is required' })

    const validStatuses = ['active', 'prospect', 'churned']
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` })
    }

    const { data, error } = await db
      .from('clients')
      .insert({
        name: name.trim(),
        display_name: display_name?.trim() ?? null,
        status,
        notes: notes ?? null,
        primary_contact_name: primary_contact_name ?? null,
        primary_contact_email: primary_contact_email ?? null,
        primary_contact_phone: primary_contact_phone ?? null,
        brand_color: brand_color ?? null,
        logo_url: logo_url ?? null,
        metadata: metadata ?? {},
        created_by: ctx.userId ?? null,
      })
      .select('*')
      .single()

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'A client with this name already exists' })
      }
      return res.status(500).json({ error: error.message })
    }

    return res.status(201).json(data)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
