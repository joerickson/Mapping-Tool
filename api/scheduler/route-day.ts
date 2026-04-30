// POST /api/scheduler/route-day
// Body: { account_id, client_id, scheduled_date, branch_name,
//   service_location_ids[], config?, preferences?, save_as_draft?, schedule_name? }
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../_lib/supabase.js'
import { authenticateRequest, type AuthContext } from '../_lib/auth.js'
import { loadConstraints, requireSelectedBranches } from '../_lib/analysis/operational-constraints.js'
import { loadAccountOfferings } from '../_lib/analysis/service-offerings.js'
import { computePropertyVisitHours } from '../_lib/analysis/property-hours.js'
import { routeDay, type DayRoutingInput, type DayRoutingResult } from '../_lib/scheduler/route-day.js'
import type { StoredConstraint } from '../_lib/scheduler/constraint-evaluator.js'

export const config = { maxDuration: 60 }

interface Body {
  account_id?: string
  client_id?: string
  scheduled_date?: string
  branch_name?: string
  service_location_ids?: string[]
  config?: Partial<DayRoutingInput['config']>
  preferences?: Partial<DayRoutingInput['preferences']>
  save_as_draft?: boolean
  schedule_name?: string
}

const DEFAULTS = {
  work_start_time: '08:00',
  work_end_time: '18:00',
  buffer_minutes_per_stop: 15,
  return_to_branch: true,
  objective: 'minimize_drive' as const,
  soft_constraint_weight: 0.5,
  allow_hard_constraint_violation: false,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let ctx: AuthContext
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const body = (req.body ?? {}) as Body
  const accountId = body.account_id
  const clientId = body.client_id
  const scheduledDate = body.scheduled_date
  const branchName = body.branch_name
  const slIds = body.service_location_ids ?? []

  if (!accountId || !clientId) {
    return res.status(400).json({ error: 'account_id and client_id required' })
  }
  if (!scheduledDate) {
    return res.status(400).json({ error: 'scheduled_date required (YYYY-MM-DD)' })
  }
  if (!branchName) {
    return res.status(400).json({ error: 'branch_name required' })
  }
  if (slIds.length === 0) {
    return res.status(400).json({ error: 'service_location_ids must be non-empty' })
  }

  const db = createAdminClient()
  const constraints = await loadConstraints(db, accountId, clientId)
  const sel = requireSelectedBranches(constraints)
  if (!sel.ok) {
    return res.status(400).json({
      error: 'Select branches before scheduling. Run Branch Optimization first.',
      code: 'BRANCHES_NOT_SELECTED',
    })
  }

  const branch = sel.branches.find(
    (b) => b.name === branchName || b.city_state === branchName
  )
  if (!branch) {
    return res.status(400).json({
      error: `Branch "${branchName}" not found in selected branches.`,
      available: sel.branches.map((b) => b.name),
    })
  }

  // Fetch service_locations + their property coords + their constraints.
  const { data: slRows, error: slErr } = await db
    .from('service_locations')
    .select('id, property_id, service_offering_id, serviceable_sqft, visits_per_year_override, hours_per_visit_override, property:properties(id, address_line1, latitude, longitude)')
    .in('id', slIds)

  if (slErr) return res.status(500).json({ error: slErr.message })

  const slIdSet = new Set(slIds)
  const { data: constraintRows, error: cErr } = await db
    .from('service_location_constraints')
    .select('id, service_location_id, constraint_type, enforcement, config, notes')
    .in('service_location_id', Array.from(slIdSet))

  if (cErr) return res.status(500).json({ error: cErr.message })
  const constraintsBySl = new Map<string, StoredConstraint[]>()
  for (const c of constraintRows ?? []) {
    const arr = constraintsBySl.get((c as any).service_location_id) ?? []
    arr.push(c as StoredConstraint)
    constraintsBySl.set((c as any).service_location_id, arr)
  }

  // We need the full property objects for property-hours computation.
  const propIds = Array.from(new Set((slRows ?? []).map((r: any) => r.property_id)))
  const { data: propRows } = await db
    .from('properties')
    .select('*, service_locations(*)')
    .in('id', propIds)

  const offerings = await loadAccountOfferings(db, accountId, clientId)
  const visits = computePropertyVisitHours(
    (propRows as any) ?? [],
    offerings,
    {
      project_clean_base_hours: constraints.project_clean_base_hours,
      project_clean_hours_per_sqft: constraints.project_clean_hours_per_sqft,
      upholstery_solo_hours: constraints.upholstery_solo_hours,
      upholstery_combo_hours_pct: constraints.upholstery_combo_hours_pct,
      visits_per_year_default: constraints.visits_per_year_default ?? 2,
    }
  )
  // Per-property visit hours include ALL of a property's SLs. For the
  // routing engine we want PER-SL hours since each row in candidate_properties
  // is one SL. Approximate by dividing the property's hours_per_visit
  // proportionally across the property's SLs by sqft (or evenly if no sqft).
  const propVisitsById = new Map<string, { hours_per_visit: number; visits_per_year: number }>()
  for (const v of visits) {
    propVisitsById.set(v.property.id, {
      hours_per_visit: v.hours_per_visit,
      visits_per_year: v.visits_per_year,
    })
  }

  const candidate_properties = (slRows ?? []).map((sl: any) => {
    const propId = sl.property_id
    const propVisit = propVisitsById.get(propId)
    const prop = sl.property
    const slSqft = sl.serviceable_sqft ?? 0
    const allSlForProp = (propRows as any)?.find((p: any) => p.id === propId)?.service_locations ?? []
    const totalSqft = allSlForProp.reduce((s: number, x: any) => s + (x.serviceable_sqft ?? 0), 0)

    const ratio = totalSqft > 0 ? slSqft / totalSqft : 1 / Math.max(1, allSlForProp.length)
    const hours_per_visit =
      sl.hours_per_visit_override ?? (propVisit ? propVisit.hours_per_visit * ratio : 1)
    const visits_per_year = sl.visits_per_year_override ?? propVisit?.visits_per_year ?? 2

    return {
      id: sl.id,
      property_id: propId,
      address: prop?.address_line1 ?? `${propId.slice(0, 8)}…`,
      lat: Number(prop?.latitude ?? NaN),
      lng: Number(prop?.longitude ?? NaN),
      hours_per_visit,
      visits_per_year,
      constraints: constraintsBySl.get(sl.id) ?? [],
    }
  })

  const routingInput: DayRoutingInput = {
    branch: { name: branch.name, lat: branch.lat, lng: branch.lng },
    scheduled_date: scheduledDate,
    candidate_properties,
    config: {
      crew_size: body.config?.crew_size ?? constraints.crew_size,
      hours_per_day: body.config?.hours_per_day ?? constraints.hours_per_day,
      work_start_time: body.config?.work_start_time ?? DEFAULTS.work_start_time,
      work_end_time: body.config?.work_end_time ?? DEFAULTS.work_end_time,
      buffer_minutes_per_stop:
        body.config?.buffer_minutes_per_stop ?? DEFAULTS.buffer_minutes_per_stop,
      drive_speed_mph: body.config?.drive_speed_mph ?? constraints.drive_speed_mph,
      return_to_branch: body.config?.return_to_branch ?? DEFAULTS.return_to_branch,
    },
    preferences: {
      objective: body.preferences?.objective ?? DEFAULTS.objective,
      soft_constraint_weight:
        body.preferences?.soft_constraint_weight ?? DEFAULTS.soft_constraint_weight,
      allow_hard_constraint_violation:
        body.preferences?.allow_hard_constraint_violation ?? DEFAULTS.allow_hard_constraint_violation,
    },
  }

  const result = routeDay(routingInput)

  let scheduleId: string | undefined
  if (body.save_as_draft) {
    scheduleId = await persistSchedule(db, ctx, {
      accountId,
      clientId,
      scheduledDate,
      branchName: branch.name,
      branchLat: branch.lat,
      branchLng: branch.lng,
      slIds,
      config: routingInput.config,
      result,
      name: body.schedule_name,
    })
  }

  return res.status(200).json({ schedule_id: scheduleId, result })
}

async function persistSchedule(
  db: ReturnType<typeof createAdminClient>,
  ctx: AuthContext,
  args: {
    accountId: string
    clientId: string
    scheduledDate: string
    branchName: string
    branchLat: number
    branchLng: number
    slIds: string[]
    config: DayRoutingInput['config']
    result: DayRoutingResult
    name?: string
  }
): Promise<string | undefined> {
  const { data, error } = await db
    .from('day_schedules')
    .insert({
      account_id: args.accountId,
      client_id: args.clientId,
      name: args.name ?? `${args.scheduledDate} — ${args.branchName}`,
      scheduled_date: args.scheduledDate,
      branch_name: args.branchName,
      branch_lat: args.branchLat,
      branch_lng: args.branchLng,
      input_property_ids: args.slIds,
      config: args.config,
      status: args.result.status === 'infeasible' ? 'failed' : 'optimized',
      optimized_at: new Date().toISOString(),
      route: args.result.route,
      total_drive_minutes: args.result.summary.total_drive_minutes,
      total_work_minutes: args.result.summary.total_work_minutes,
      total_buffer_minutes: args.result.summary.total_buffer_minutes,
      total_day_minutes: args.result.summary.total_day_minutes,
      total_drive_miles: args.result.summary.total_drive_miles,
      start_time: args.result.summary.start_time,
      end_time: args.result.summary.end_time,
      return_to_branch: args.config.return_to_branch,
      hard_constraint_violations: args.result.summary.hard_constraint_violations,
      soft_constraint_violations: args.result.summary.soft_constraint_violations,
      optimization_score: args.result.summary.optimization_score,
      excluded_property_ids: args.result.excluded_properties.map((e) => e.service_location_id),
      exclusion_reasons: args.result.excluded_properties,
      created_by: ctx.email ?? ctx.userId ?? null,
    })
    .select('id')
    .single()
  if (error) {
    console.error('day_schedules insert failed:', error.message)
    return undefined
  }
  return (data as { id: string }).id
}
