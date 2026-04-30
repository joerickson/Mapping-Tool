// GET /api/clients/[clientId]/addon-cohorts/[offeringId]
// Returns current cohort assignments grouped by cohort.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../../_lib/supabase.js'
import { authenticateRequest } from '../../../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try { await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const clientId = req.query.clientId as string
  const offeringId = req.query.offeringId as string
  const db = createAdminClient()

  const { data: offering } = await db
    .from('service_offerings')
    .select('id, name, visit_interval_years')
    .eq('id', offeringId)
    .single()

  const { data: rows } = await db
    .from('addon_cohort_assignments')
    .select('id, service_location_id, cohort_index, cohort_total, next_due_year, last_completed_date, assignment_method, assigned_at, service_locations(id, property:properties(id, address_line1, state, latitude, longitude))')
    .eq('service_offering_id', offeringId)
    .eq('client_id', clientId)
    .order('cohort_index')

  const cohorts = new Map<number, any>()
  let lastAssigned: string | null = null
  let lastMethod: string | null = null
  for (const r of rows ?? []) {
    const row = r as any
    if (!lastAssigned || row.assigned_at > lastAssigned) {
      lastAssigned = row.assigned_at
      lastMethod = row.assignment_method
    }
    const c = cohorts.get(row.cohort_index) ?? {
      cohort_index: row.cohort_index,
      next_due_year: row.next_due_year,
      property_count: 0,
      properties: [] as any[],
    }
    c.property_count++
    const sl = row.service_locations
    const p = sl?.property
    c.properties.push({
      service_location_id: row.service_location_id,
      property_id: p?.id,
      address: p?.address_line1 ?? '',
      state: p?.state ?? null,
      lat: p?.latitude ?? null,
      lng: p?.longitude ?? null,
      assignment_method: row.assignment_method,
      last_completed_date: row.last_completed_date,
    })
    cohorts.set(row.cohort_index, c)
  }

  return res.status(200).json({
    offering_id: offeringId,
    offering_name: (offering as any)?.name ?? '',
    cohort_total: Math.round(Number((offering as any)?.visit_interval_years ?? 0)),
    last_assigned_at: lastAssigned,
    last_method: lastMethod,
    cohorts: Array.from(cohorts.values()).sort((a, b) => a.cohort_index - b.cohort_index),
  })
}
