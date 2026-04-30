// GET  /api/v1/clients/[id]/service-line-pricing
//   → list of pricing configs for this client (with offering name resolved)
// PUT  /api/v1/clients/[id]/service-line-pricing
//   Body: { configs: Array<{ service_offering_id, pricing_model,
//     rate_per_sqft_per_visit?, rate_per_sqft_per_month?, billable_sqft_pct,
//     billable_sqft_pct_notes?, target_gross_margin_pct_override? }> }
//
// Phase 4 — service line pricing config write path. PUT upserts each row
// keyed by (account_id, client_id, service_offering_id). Inferred
// account_id from the first matching service_location row for this client.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const clientId = req.query.id as string
  if (!clientId) return res.status(400).json({ error: 'client id required' })
  const db = createAdminClient()

  // Resolve account_id once. The client row has it.
  const { data: clientRow } = await db
    .from('clients')
    .select('account_id')
    .eq('id', clientId)
    .maybeSingle()
  const accountId = (clientRow as any)?.account_id as string | undefined
  if (!accountId) return res.status(404).json({ error: 'Client not found' })

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('service_line_pricing_config')
      .select(
        'id, service_offering_id, pricing_model, rate_per_sqft_per_visit, rate_per_sqft_per_month, billable_sqft_pct, billable_sqft_pct_notes, target_gross_margin_pct_override, is_active, updated_at, service_offering:service_offerings(id, name, offering_role)'
      )
      .eq('account_id', accountId)
      .eq('client_id', clientId)
      .eq('is_active', true)
      .order('updated_at', { ascending: true })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ configs: data ?? [] })
  }

  if (req.method === 'PUT') {
    const body = (req.body ?? {}) as Record<string, unknown>
    const configs = Array.isArray(body.configs) ? body.configs : []
    if (configs.length === 0) {
      return res.status(400).json({ error: 'configs[] required' })
    }
    const now = new Date().toISOString()
    const rows: any[] = []
    for (const c of configs as any[]) {
      if (!c.service_offering_id || typeof c.service_offering_id !== 'string') continue
      const model = c.pricing_model
      if (model !== 'per_visit_blended_sqft' && model !== 'per_sqft_monthly') continue
      const billable = Number(c.billable_sqft_pct ?? 100)
      const marginOv =
        c.target_gross_margin_pct_override == null ||
        c.target_gross_margin_pct_override === ''
          ? null
          : Number(c.target_gross_margin_pct_override)
      rows.push({
        account_id: accountId,
        client_id: clientId,
        service_offering_id: c.service_offering_id,
        pricing_model: model,
        rate_per_sqft_per_visit:
          model === 'per_visit_blended_sqft' && c.rate_per_sqft_per_visit != null
            ? Number(c.rate_per_sqft_per_visit)
            : null,
        rate_per_sqft_per_month:
          model === 'per_sqft_monthly' && c.rate_per_sqft_per_month != null
            ? Number(c.rate_per_sqft_per_month)
            : null,
        billable_sqft_pct: Number.isFinite(billable) ? billable : 100,
        billable_sqft_pct_notes:
          typeof c.billable_sqft_pct_notes === 'string'
            ? c.billable_sqft_pct_notes
            : null,
        target_gross_margin_pct_override:
          marginOv != null && Number.isFinite(marginOv) ? marginOv : null,
        is_active: true,
        updated_at: now,
      })
    }
    if (rows.length === 0) {
      return res.status(400).json({ error: 'No valid configs to save' })
    }
    const { error } = await db
      .from('service_line_pricing_config')
      .upsert(rows, { onConflict: 'account_id,client_id,service_offering_id' })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ saved: rows.length })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
