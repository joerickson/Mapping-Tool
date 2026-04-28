import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase'
import { authenticateRequest } from '../../../_lib/auth'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  let ctx: Awaited<ReturnType<typeof authenticateRequest>>
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const accountId = req.query.id as string
  const db = createAdminClient()

  // Verify account exists and is property_manager
  const { data: account, error: accErr } = await db
    .from('accounts')
    .select('id, account_type')
    .eq('id', accountId)
    .single()

  if (accErr || !account) return res.status(404).json({ error: 'Account not found' })

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('clients')
      .select('*')
      .eq('account_id', accountId)
      .order('name', { ascending: true })

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data ?? [])
  }

  if (req.method === 'POST') {
    if (account.account_type === 'self_managed') {
      return res.status(400).json({ error: 'Self-managed accounts cannot add clients manually' })
    }

    const {
      name, display_name, status = 'active',
      notes, contact_name, contact_email, contact_phone,
    } = req.body ?? {}

    if (!name?.trim()) return res.status(400).json({ error: 'name is required' })

    const { data: client, error: clientErr } = await db
      .from('clients')
      .insert({
        account_id: accountId,
        name: name.trim(),
        display_name: display_name?.trim() ?? null,
        status,
        notes: notes ?? null,
        primary_contact_name: contact_name ?? null,
        primary_contact_email: contact_email ?? null,
        primary_contact_phone: contact_phone ?? null,
        created_by: ctx.userId ?? null,
      })
      .select('*')
      .single()

    if (clientErr) {
      if (clientErr.code === '23505') return res.status(409).json({ error: 'A client with this name already exists under this account' })
      return res.status(500).json({ error: clientErr.message })
    }

    return res.status(201).json(client)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
