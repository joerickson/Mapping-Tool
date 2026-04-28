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
    const { status, search } = req.query
    let query = db.from('accounts').select('*').order('name', { ascending: true })
    if (status) query = query.eq('status', String(status))
    if (search) query = query.ilike('name', `%${String(search)}%`)
    const { data, error } = await query
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data ?? [])
  }

  if (req.method === 'POST') {
    const {
      name, display_name, account_type = 'self_managed', status = 'active',
      notes, primary_contact_name, primary_contact_email, primary_contact_phone,
      brand_color, logo_url, metadata,
    } = req.body ?? {}

    if (!name?.trim()) return res.status(400).json({ error: 'name is required' })
    const validTypes = ['self_managed', 'property_manager']
    if (!validTypes.includes(account_type)) {
      return res.status(400).json({ error: `account_type must be one of: ${validTypes.join(', ')}` })
    }

    const { data: account, error: accErr } = await db
      .from('accounts')
      .insert({
        name: name.trim(),
        display_name: display_name?.trim() ?? null,
        account_type,
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

    if (accErr) {
      if (accErr.code === '23505') return res.status(409).json({ error: 'An account with this name already exists' })
      return res.status(500).json({ error: accErr.message })
    }

    // For self_managed accounts, auto-create a matching client
    if (account_type === 'self_managed') {
      const { data: client, error: clientErr } = await db
        .from('clients')
        .insert({
          account_id: account.id,
          name: account.name,
          display_name: account.display_name ?? null,
          status: 'active',
          created_by: ctx.userId ?? null,
        })
        .select('id')
        .single()

      if (clientErr) {
        // Roll back the account we just created so the user can retry cleanly
        await db.from('accounts').delete().eq('id', account.id)
        if (clientErr.code === '23505') {
          return res.status(409).json({ error: 'A client with this name already exists. Please choose a different account name.' })
        }
        return res.status(500).json({ error: clientErr.message })
      }

      return res.status(201).json({ ...account, auto_client_id: client!.id })
    }

    return res.status(201).json(account)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
