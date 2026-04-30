// Phase 4d — addon cohort auto-assignment.
//
// For addons with visit_interval_years > 1 (e.g. Upholstery every 3 years),
// properties get split across N cohorts (N = interval). Cohort 0 is due
// in start_year, cohort 1 in start_year+1, … This rotates the workload
// so 1/N of properties get the addon each calendar year.
//
// The geographic method round-robins around the centroid by angle —
// each cohort ends up with even regional coverage instead of one cohort
// being "all the TX properties" and another "all the NM properties".
import type { SupabaseClient } from '@supabase/supabase-js'
import { haversineMiles } from '../analysis/haversine.js'
import { groupByNearestBranch } from './cluster.js'

export interface EligibleProperty {
  service_location_id: string
  property_id: string
  account_id: string
  client_id: string
  lat: number
  lng: number
  state?: string | null
}

export interface CohortAssignmentInput {
  account_id: string
  client_id: string
  service_offering_id: string
  cohort_total: number
  start_year: number
  method: 'geographic' | 'random' | 'branch'
  preserve_existing?: boolean
  eligible_properties: EligibleProperty[]
  branches?: Array<{ name: string; lat: number; lng: number }>
}

export interface CohortAssignmentRow {
  service_location_id: string
  service_offering_id: string
  account_id: string
  client_id: string
  cohort_index: number
  cohort_total: number
  next_due_year: number
  assignment_method: 'auto_balanced' | 'manual_override' | 'imported'
  assigned_by: string
}

export interface CohortAssignmentResult {
  assignments_created: number
  assignments_updated: number
  cohort_breakdown: Array<{
    cohort_index: number
    next_due_year: number
    property_count: number
    average_lat: number
    average_lng: number
  }>
  method_used: string
}

export function planCohortAssignments(input: CohortAssignmentInput): CohortAssignmentRow[] {
  const { eligible_properties, cohort_total, start_year, method, service_offering_id } = input
  if (eligible_properties.length === 0) return []

  let ordered: EligibleProperty[]
  if (method === 'geographic') {
    const centroidLat = avg(eligible_properties.map((p) => p.lat))
    const centroidLng = avg(eligible_properties.map((p) => p.lng))
    ordered = [...eligible_properties].sort((a, b) => {
      const angleA = Math.atan2(a.lat - centroidLat, a.lng - centroidLng)
      const angleB = Math.atan2(b.lat - centroidLat, b.lng - centroidLng)
      return angleA - angleB
    })
  } else if (method === 'branch') {
    const branches = input.branches ?? []
    if (branches.length === 0) {
      // Fallback to random when no branches provided.
      ordered = shuffle(eligible_properties)
    } else {
      const grouped = groupByNearestBranch(eligible_properties, branches)
      const concat: EligibleProperty[] = []
      for (const arr of grouped.values()) concat.push(...shuffle(arr))
      ordered = concat
    }
  } else {
    ordered = shuffle(eligible_properties)
  }

  return ordered.map((p, i) => ({
    service_location_id: p.service_location_id,
    service_offering_id,
    account_id: p.account_id,
    client_id: p.client_id,
    cohort_index: i % cohort_total,
    cohort_total,
    next_due_year: start_year + (i % cohort_total),
    assignment_method: 'auto_balanced',
    assigned_by: 'system_auto',
  }))
}

// Apply the assignments to the DB. preserve_existing=true skips properties
// that already have an assignment for this offering. preserve_existing=false
// rebalances from scratch: deletes all existing rows for this offering
// within (account, client) first.
export async function applyCohortAssignments(
  db: SupabaseClient,
  input: CohortAssignmentInput
): Promise<CohortAssignmentResult> {
  const planned = planCohortAssignments(input)
  let preExisting: Set<string> = new Set()

  if (input.preserve_existing !== false) {
    const { data } = await db
      .from('addon_cohort_assignments')
      .select('service_location_id')
      .eq('service_offering_id', input.service_offering_id)
      .eq('account_id', input.account_id)
      .eq('client_id', input.client_id)
    preExisting = new Set((data ?? []).map((r) => (r as { service_location_id: string }).service_location_id))
  } else {
    // Rebalance: delete first.
    await db
      .from('addon_cohort_assignments')
      .delete()
      .eq('service_offering_id', input.service_offering_id)
      .eq('account_id', input.account_id)
      .eq('client_id', input.client_id)
  }

  const toInsert = planned.filter((p) => !preExisting.has(p.service_location_id))
  let created = 0
  if (toInsert.length > 0) {
    const { error } = await db
      .from('addon_cohort_assignments')
      .insert(toInsert.map((p) => ({ ...p, assigned_at: new Date().toISOString() })))
    if (!error) created = toInsert.length
    else console.error('[cohort-assigner] insert failed:', error.message)
  }

  // Build breakdown
  const byCohort = new Map<number, { lats: number[]; lngs: number[]; year: number }>()
  for (const p of planned) {
    const slot = byCohort.get(p.cohort_index) ?? { lats: [], lngs: [], year: p.next_due_year }
    const eligible = input.eligible_properties.find((e) => e.service_location_id === p.service_location_id)
    if (eligible) {
      slot.lats.push(eligible.lat)
      slot.lngs.push(eligible.lng)
    }
    byCohort.set(p.cohort_index, slot)
  }
  const cohortBreakdown = Array.from(byCohort.entries())
    .sort(([a], [b]) => a - b)
    .map(([cohort_index, v]) => ({
      cohort_index,
      next_due_year: v.year,
      property_count: v.lats.length,
      average_lat: avg(v.lats),
      average_lng: avg(v.lngs),
    }))

  return {
    assignments_created: created,
    assignments_updated: 0,
    cohort_breakdown: cohortBreakdown,
    method_used: input.method,
  }
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// Helper: load eligible properties for an addon offering (those whose
// service_location.service_offering_id is one of the addon's parent
// offering ids). Used by both the auto-assign endpoint and template
// generation's silent backfill.
export async function loadEligibleProperties(
  db: SupabaseClient,
  accountId: string,
  clientId: string,
  parentOfferingIds: string[]
): Promise<EligibleProperty[]> {
  if (parentOfferingIds.length === 0) return []
  const { data } = await db
    .from('service_locations')
    .select('id, account_id, client_id, property:properties(id, latitude, longitude, state)')
    .in('service_offering_id', parentOfferingIds)
    .eq('client_id', clientId)
  const out: EligibleProperty[] = []
  for (const row of data ?? []) {
    const sl = row as any
    const p = sl.property
    if (!p?.latitude || !p?.longitude) continue
    out.push({
      service_location_id: sl.id,
      property_id: p.id,
      account_id: sl.account_id ?? accountId,
      client_id: sl.client_id ?? clientId,
      lat: Number(p.latitude),
      lng: Number(p.longitude),
      state: p.state ?? null,
    })
  }
  return out
}
