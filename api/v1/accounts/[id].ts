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

  const id = req.query.id as string
  const db = createAdminClient()

  if (req.method === 'GET') {
    const { data: account, error } = await db
      .from('accounts')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !account) return res.status(404).json({ error: 'Account not found' })

    // Attach stats
    const { count: clientCount, data: accountClients } = await db
      .from('clients')
      .select('id', { count: 'exact' })
      .eq('account_id', id)

    const clientIds = (accountClients ?? []).map((c) => c.id)
    let slCount = 0
    if (clientIds.length > 0) {
      const { count } = await db
        .from('service_locations')
        .select('service_location_id', { count: 'exact', head: true })
        .in('client_id', clientIds)
      slCount = count ?? 0
    }

    const { data: recentUploads } = await db
      .from('upload_batches')
      .select('upload_batch_id, filename, status, row_count, created_at')
      .eq('account_id', id)
      .order('created_at', { ascending: false })
      .limit(5)

    return res.status(200).json({
      ...account,
      stats: {
        client_count: clientCount ?? 0,
        service_location_count: slCount,
      },
      recent_uploads: recentUploads ?? [],
    })
  }

  if (req.method === 'PATCH') {
    const allowed = [
      'name', 'display_name', 'status', 'notes',
      'primary_contact_name', 'primary_contact_email', 'primary_contact_phone',
      'brand_color', 'logo_url', 'metadata',
    ]
    const patch: Record<string, unknown> = {}
    for (const key of allowed) {
      if (key in (req.body ?? {})) patch[key] = req.body[key]
    }
    if (patch.name && typeof patch.name === 'string') patch.name = (patch.name as string).trim()
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'No fields to update' })

    const { data, error } = await db
      .from('accounts')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single()

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'An account with this name already exists' })
      return res.status(500).json({ error: error.message })
    }
    return res.status(200).json(data)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
