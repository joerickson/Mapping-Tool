// POST /api/clients/[clientId]/addon-cohorts/[offeringId]/auto-assign
// Body: { method?, start_year?, preserve_existing? }
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
  const clientId = req.query.clientId as string
  const offeringId = req.query.offeringId as string
  const body = (req.body ?? {}) as Record<string, unknown>
  const method = (body.method as 'geographic' | 'random' | 'branch' | undefined) ?? 'geographic'
  const startYear = (body.start_year as number | undefined) ?? new Date().getUTCFullYear()
  const preserveExisting = body.preserve_existing !== false

  const db = createAdminClient()

  const { data: offering } = await db
    .from('service_offerings')
    .select('id, account_id, attaches_to_offering_ids, visit_interval_years')
    .eq('id', offeringId)
    .single()
  if (!offering) return res.status(404).json({ error: 'Offering not found' })
  const o = offering as any
  const cohortTotal = Math.max(1, Math.round(Number(o.visit_interval_years ?? 1)))
  const parents = (o.attaches_to_offering_ids ?? []) as string[]
  if (parents.length === 0) {
    return res.status(400).json({ error: 'Offering has no parent attachments' })
  }

  const eligible = await loadEligibleProperties(db, o.account_id, clientId, parents)
  if (eligible.length === 0) {
    return res.status(200).json({
      assignments_created: 0,
      assignments_updated: 0,
      cohort_breakdown: [],
      method_used: method,
      message: 'No eligible properties found.',
    })
  }

  const result = await applyCohortAssignments(db, {
    account_id: o.account_id,
    client_id: clientId,
    service_offering_id: offeringId,
    cohort_total: cohortTotal,
    start_year: startYear,
    method,
    preserve_existing: preserveExisting,
    eligible_properties: eligible,
  })

  return res.status(200).json(result)
}
