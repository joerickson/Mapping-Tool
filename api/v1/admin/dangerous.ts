import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let ctx: Awaited<ReturnType<typeof authenticateRequest>>
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  // Only user-context auth can perform this action
  if (ctx.mode !== 'user') {
    return res.status(403).json({ error: 'This action requires user authentication' })
  }

  const { action, confirmation } = req.body ?? {}

  if (action === 'reset_service_location_data') {
    if (confirmation !== 'delete all data') {
      return res.status(400).json({ error: 'Invalid confirmation phrase' })
    }

    const db = createAdminClient()

    // Truncate in FK dependency order
    try {
      await db.from('staged_addresses').delete().neq('staged_id', '00000000-0000-0000-0000-000000000000')
      await db.from('upload_batches').delete().neq('upload_batch_id', '00000000-0000-0000-0000-000000000000')
      await db.from('service_locations').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      await db.from('properties').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      await db.from('client_templates').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      await db.from('custom_field_definitions').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      await db.from('service_offerings').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      await db.from('portfolios').delete().neq('portfolio_id', '00000000-0000-0000-0000-000000000000')
      await db.from('clients').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      await db.from('accounts').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'Reset failed' })
    }

    // Log the action (best-effort)
    db.from('admin_audit_log')
      .insert({
        action: 'reset_service_location_data',
        performed_by: ctx.userId,
        performed_at: new Date().toISOString(),
      })
      .then(null, () => {})

    return res.status(200).json({
      ok: true,
      message: 'All data has been wiped: accounts, clients, service offerings, custom fields, templates, properties, service locations, upload batches, and portfolios.',
      performed_by: ctx.email ?? ctx.userId,
      performed_at: new Date().toISOString(),
    })
  }

  return res.status(400).json({ error: `Unknown action: ${action}` })
}
