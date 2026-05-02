import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../../_lib/supabase.js'
import { authenticateRequest } from '../../../../_lib/auth.js'

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
    const body = (req.body ?? {}) as Record<string, unknown>
    const isCombined = body.is_combined === true
    const memberIds = Array.isArray(body.member_client_ids)
      ? (body.member_client_ids as string[]).filter((s) => typeof s === 'string')
      : []

    // Combined clients are a virtual portfolio across N member clients.
    // They can be hosted under any account type (the host account is just
    // for nav/permission scope) — the self_managed restriction only
    // applies to ordinary clients.
    if (!isCombined && account.account_type === 'self_managed') {
      return res.status(400).json({ error: 'Self-managed accounts cannot add clients manually' })
    }

    if (isCombined) {
      if (memberIds.length < 2) {
        return res.status(400).json({ error: 'Combined clients require at least 2 member_client_ids' })
      }
      // Verify all member ids exist and are not themselves combined.
      const { data: members, error: mErr } = await db
        .from('clients')
        .select('id, is_combined')
        .in('id', memberIds)
      if (mErr) return res.status(500).json({ error: mErr.message })
      const found = new Set((members ?? []).map((m: any) => m.id as string))
      const missing = memberIds.filter((id) => !found.has(id))
      if (missing.length > 0) {
        return res.status(400).json({ error: `Unknown member client ids: ${missing.join(', ')}` })
      }
      const nestedCombined = (members ?? []).filter((m: any) => m.is_combined)
      if (nestedCombined.length > 0) {
        return res.status(400).json({ error: 'Cannot nest combined clients (a member is itself combined)' })
      }
    }

    const name = body.name as string | undefined
    const displayName = body.display_name as string | undefined
    const status = (body.status as string | undefined) ?? 'active'

    if (!name?.trim()) return res.status(400).json({ error: 'name is required' })

    const { data: client, error: clientErr } = await db
      .from('clients')
      .insert({
        account_id: accountId,
        name: name.trim(),
        display_name: displayName?.trim() ?? null,
        status,
        notes: (body.notes as string | undefined) ?? null,
        primary_contact_name: (body.contact_name as string | undefined) ?? null,
        primary_contact_email: (body.contact_email as string | undefined) ?? null,
        primary_contact_phone: (body.contact_phone as string | undefined) ?? null,
        is_combined: isCombined,
        member_client_ids: isCombined ? memberIds : null,
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
