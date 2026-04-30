// Phase 4.1 — POST cluster override for the overnight calculator.
//
//   POST /api/analyses/account/[accountId]/clients/[clientId]/cluster-override
//   body: {
//     cluster_id, cluster_label,
//     nights_per_trip_override?, trips_per_year_override?,
//     cost_per_night_override?, per_diem_per_night_override?,
//     skip_overnight?, skip_overnight_reason?,
//     override_reason?
//   }
//
// Behavior:
// - If every override field is null/undefined and skip_overnight is
//   false, the saved row is deleted (clear).
// - Otherwise upsert by (account_id, client_id, cluster_id).
// - Returns { ok: true, cleared: boolean }.
//
// Pre-validation (does the cluster_id exist in the current calc) is
// the UI's job — saving an override against a stale id is allowed
// because property contents change frequently and we don't want to
// drop user intent.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../../../_lib/supabase.js'
import { authenticateRequest } from '../../../../../_lib/auth.js'

export const config = { maxDuration: 10 }

interface Body {
  cluster_id?: string
  cluster_label?: string
  nights_per_trip_override?: number | null
  trips_per_year_override?: number | null
  cost_per_night_override?: number | null
  per_diem_per_night_override?: number | null
  skip_overnight?: boolean
  skip_overnight_reason?: string | null
  override_reason?: string | null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let userEmail: string | null = null
  try {
    const auth = await authenticateRequest(req)
    userEmail = auth.email ?? null
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const accountId = req.query.accountId as string
  const clientId = req.query.clientId as string
  if (!accountId || !clientId) {
    return res.status(400).json({ error: 'accountId and clientId required' })
  }

  const body = (req.body ?? {}) as Body
  if (!body.cluster_id || typeof body.cluster_id !== 'string') {
    return res.status(400).json({ error: 'cluster_id is required' })
  }
  if (!body.cluster_label || typeof body.cluster_label !== 'string') {
    return res.status(400).json({ error: 'cluster_label is required' })
  }

  // Validation
  if (body.cost_per_night_override != null && body.cost_per_night_override < 0) {
    return res.status(400).json({ error: 'cost_per_night_override must be >= 0' })
  }
  if (body.per_diem_per_night_override != null && body.per_diem_per_night_override < 0) {
    return res.status(400).json({ error: 'per_diem_per_night_override must be >= 0' })
  }
  if (body.nights_per_trip_override != null && body.nights_per_trip_override < 0) {
    return res.status(400).json({ error: 'nights_per_trip_override must be >= 0' })
  }
  if (body.trips_per_year_override != null && body.trips_per_year_override < 0) {
    return res.status(400).json({ error: 'trips_per_year_override must be >= 0' })
  }

  const db = createAdminClient()

  // Treat the row as a clear if no field is set AND skip is false.
  const isClear =
    !body.skip_overnight &&
    body.nights_per_trip_override == null &&
    body.trips_per_year_override == null &&
    body.cost_per_night_override == null &&
    body.per_diem_per_night_override == null

  if (isClear) {
    const { error } = await db
      .from('overnight_cluster_overrides')
      .delete()
      .eq('account_id', accountId)
      .eq('client_id', clientId)
      .eq('cluster_id', body.cluster_id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true, cleared: true })
  }

  const { error } = await db
    .from('overnight_cluster_overrides')
    .upsert(
      {
        account_id: accountId,
        client_id: clientId,
        cluster_id: body.cluster_id,
        cluster_label: body.cluster_label,
        nights_per_trip_override: body.nights_per_trip_override ?? null,
        trips_per_year_override: body.trips_per_year_override ?? null,
        cost_per_night_override: body.cost_per_night_override ?? null,
        per_diem_per_night_override: body.per_diem_per_night_override ?? null,
        skip_overnight: !!body.skip_overnight,
        skip_overnight_reason: body.skip_overnight_reason ?? null,
        override_reason: body.override_reason ?? null,
        overridden_by: userEmail,
        overridden_at: new Date().toISOString(),
      },
      { onConflict: 'account_id,client_id,cluster_id' }
    )
  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ ok: true, cleared: false })
}
