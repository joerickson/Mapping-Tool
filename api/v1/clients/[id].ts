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

  const db = createAdminClient()
  const id = req.query.id as string

  // ── GET /api/v1/clients/:id ───────────────────────────────────────────────
  if (req.method === 'GET') {
    const { data: client, error } = await db
      .from('clients')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !client) return res.status(404).json({ error: 'Client not found' })

    // Stats: service location count, portfolio count, total sqft; also template config status
    const [slRes, portRes, sqftRes, uploadRes, templateRes, accountRes] = await Promise.all([
      db.from('service_locations').select('id', { count: 'exact', head: true }).eq('client_id', id),
      db.from('portfolios').select('portfolio_id', { count: 'exact', head: true }).eq('client_id', id),
      db.from('service_locations').select('serviceable_sqft').eq('client_id', id).not('serviceable_sqft', 'is', null),
      db.from('upload_batches').select('upload_batch_id, filename, created_at, status, row_count').eq('client_id', id).order('created_at', { ascending: false }).limit(20),
      db.from('client_templates').select('is_configured').eq('client_id', id).maybeSingle(),
      (client as any).account_id
        ? db.from('accounts').select('id, name, display_name, account_type').eq('id', (client as any).account_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ])

    const totalSqft = (sqftRes.data ?? []).reduce((sum: number, r: any) => sum + (r.serviceable_sqft ?? 0), 0)

    return res.status(200).json({
      ...client,
      account: (accountRes as any).data ?? null,
      is_configured: (templateRes as any).data?.is_configured ?? false,
      stats: {
        service_location_count: slRes.count ?? 0,
        portfolio_count: portRes.count ?? 0,
        total_serviceable_sqft: totalSqft,
      },
      recent_uploads: uploadRes.data ?? [],
    })
  }

  // ── PATCH /api/v1/clients/:id ─────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const {
      name,
      display_name,
      status,
      notes,
      primary_contact_name,
      primary_contact_email,
      primary_contact_phone,
      brand_color,
      logo_url,
      metadata,
    } = req.body ?? {}

    const updates: Record<string, unknown> = {}
    if (name !== undefined) updates.name = name.trim()
    if (display_name !== undefined) updates.display_name = display_name?.trim() ?? null
    if (status !== undefined) {
      const valid = ['active', 'prospect', 'churned']
      if (!valid.includes(status)) return res.status(400).json({ error: `status must be one of: ${valid.join(', ')}` })
      updates.status = status
    }
    if (notes !== undefined) updates.notes = notes ?? null
    if (primary_contact_name !== undefined) updates.primary_contact_name = primary_contact_name ?? null
    if (primary_contact_email !== undefined) updates.primary_contact_email = primary_contact_email ?? null
    if (primary_contact_phone !== undefined) updates.primary_contact_phone = primary_contact_phone ?? null
    if (brand_color !== undefined) updates.brand_color = brand_color ?? null
    if (logo_url !== undefined) updates.logo_url = logo_url ?? null
    if (metadata !== undefined) updates.metadata = metadata ?? {}

    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No fields to update' })

    const { data, error } = await db
      .from('clients')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single()

    if (error) return res.status(500).json({ error: error.message })
    if (!data) return res.status(404).json({ error: 'Client not found' })

    return res.status(200).json(data)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
