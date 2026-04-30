// POST /api/clients/[clientId]/addon-cohorts/[offeringId]/rebalance
// Same as auto-assign with preserve_existing=false. Requires ?confirm=true
// to actually run — first call returns confirmation_required so the UI
// can show "are you sure" before destroying existing assignments.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../../_lib/supabase.js'
import { authenticateRequest } from '../../../../_lib/auth.js'
import {
  applyCohortAssignments,
  loadEligibleProperties,
} from '../../../../_lib/scheduler/cohort-assigner.js'

export const config = { maxDuration: 30 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try { await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const confirm = String(req.query.confirm ?? '').toLowerCase() === 'true'
  if (!confirm) {
    return res.status(400).json({
      error: 'Rebalance is destructive — pass ?confirm=true to proceed',
      confirmation_required: true,
    })
  }

  const clientId = req.query.clientId as string
  const offeringId = req.query.offeringId as string
  const body = (req.body ?? {}) as Record<string, unknown>
  const method = (body.method as 'geographic' | 'random' | 'branch' | undefined) ?? 'geographic'
  const startYear = (body.start_year as number | undefined) ?? new Date().getUTCFullYear()

  const db = createAdminClient()
  const { data: offering } = await db
    .from('service_offerings')
    .select('account_id, attaches_to_offering_ids, visit_interval_years')
    .eq('id', offeringId)
    .single()
  if (!offering) return res.status(404).json({ error: 'Offering not found' })
  const o = offering as any
  const cohortTotal = Math.max(1, Math.round(Number(o.visit_interval_years ?? 1)))
  const parents = (o.attaches_to_offering_ids ?? []) as string[]

  const eligible = await loadEligibleProperties(db, o.account_id, clientId, parents)
  const result = await applyCohortAssignments(db, {
    account_id: o.account_id,
    client_id: clientId,
    service_offering_id: offeringId,
    cohort_total: cohortTotal,
    start_year: startYear,
    method,
    preserve_existing: false,
    eligible_properties: eligible,
  })

  return res.status(200).json(result)
}
