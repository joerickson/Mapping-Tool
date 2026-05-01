// GET  /api/scheduler/templates?account_id=&client_id=&status=
// POST /api/scheduler/templates — create + run buildRoutingTemplate
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest, type AuthContext } from '../../_lib/auth.js'
import {
  loadConstraints,
  requireSelectedBranches,
} from '../../_lib/analysis/operational-constraints.js'
import { loadAccountOfferings } from '../../_lib/analysis/service-offerings.js'
import { computePropertyVisitHours } from '../../_lib/analysis/property-hours.js'
import {
  buildRoutingTemplate,
  type PropertyForBuild,
} from '../../_lib/scheduler/build-routing-template.js'
import {
  applyCohortAssignments,
  loadEligibleProperties,
} from '../../_lib/scheduler/cohort-assigner.js'
import type { StoredConstraint } from '../../_lib/scheduler/constraint-evaluator.js'

export const config = { maxDuration: 300 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  let ctx: AuthContext
  try { ctx = await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const db = createAdminClient()

  if (req.method === 'GET') {
    const accountId = req.query.account_id as string | undefined
    const clientId = req.query.client_id as string | undefined
    if (!accountId || !clientId) {
      return res.status(400).json({ error: 'account_id and client_id required' })
    }
    let q = db
      .from('routing_templates')
      .select('id, name, description, status, crew_count, cycle_length_days, cycle_length_label, total_visits_per_cycle, total_estimated_cost_per_year, optimization_score, hard_constraint_violations, soft_constraint_violations, created_at, optimized_at')
      .eq('account_id', accountId)
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
    const status = req.query.status as string | undefined
    if (status) q = q.in('status', String(status).split(','))
    const { data, error } = await q.limit(100)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ templates: data ?? [] })
  }

  if (req.method === 'POST') {
    const body = (req.body ?? {}) as Record<string, unknown>
    const accountId = body.account_id as string
    const clientId = body.client_id as string
    const slIds = (body.service_location_ids as string[]) ?? []
    const crewCount = Number(body.crew_count ?? 1)

    if (!accountId || !clientId) {
      return res.status(400).json({ error: 'account_id and client_id required' })
    }
    if (slIds.length === 0) {
      return res.status(400).json({ error: 'service_location_ids must be non-empty' })
    }

    const constraints = await loadConstraints(db, accountId, clientId)
    const sel = requireSelectedBranches(constraints)
    if (!sel.ok) {
      return res.status(400).json({
        error: 'No branches selected. Run Branch Optimization first.',
        code: 'BRANCHES_NOT_SELECTED',
      })
    }
    const branches = sel.branches.map((b) => ({ name: b.name, lat: b.lat, lng: b.lng }))

    // Fetch SLs + properties + offerings. Chunk by 250 ids (URL length
    // safety) AND page each chunk because PostgREST silently caps page
    // size — combined this query previously truncated at 500 SLs even
    // when slIds had 500+ entries, dropping the rest from the schedule.
    const SL_CHUNK = 250
    const SL_PAGE = 1000
    const slRows: any[] = []
    for (let i = 0; i < slIds.length; i += SL_CHUNK) {
      const idChunk = slIds.slice(i, i + SL_CHUNK)
      let pageOffset = 0
      for (let p = 0; p < 50; p++) {
        const { data } = await db
          .from('service_locations')
          .select('id, property_id, service_offering_id, serviceable_sqft, hours_per_visit_override, building_size_class_override, property:properties(id, address_line1, latitude, longitude)')
          .in('id', idChunk)
          .range(pageOffset, pageOffset + SL_PAGE - 1)
        const batch = data ?? []
        slRows.push(...batch)
        if (batch.length < SL_PAGE) break
        pageOffset += SL_PAGE
      }
    }
    const { data: offeringRows } = await db
      .from('service_offerings')
      .select('id, name, is_routed, offering_role, visit_interval_years, attaches_to_offering_ids, uses_cohort_rotation')
      .eq('client_id', clientId)
    const offerings = new Map<string, any>()
    for (const o of offeringRows ?? []) offerings.set((o as any).id, o)

    // Filter to is_routed=parent properties.
    type RoutedRow = {
      sl: any
      offering: any
    }
    const routed: RoutedRow[] = []
    for (const r of slRows ?? []) {
      const sl = r as any
      const off = offerings.get(sl.service_offering_id)
      if (off?.is_routed && off.offering_role === 'parent') {
        routed.push({ sl, offering: off })
      }
    }
    if (routed.length === 0) {
      return res.status(400).json({
        error: 'No routed offerings in selection. Configure offerings as routed in Operational Constraints first.',
      })
    }

    // For each addon offering attaching to one of these parents, ensure
    // cohorts exist for the routed properties; auto-assign silently if missing.
    const parentOfferingIds = new Set(routed.map((r) => r.offering.id))
    const addonOfferings = (offeringRows ?? [])
      .filter((o: any) => o.is_routed && o.offering_role === 'addon' &&
        ((o.attaches_to_offering_ids ?? []) as string[]).some((id) => parentOfferingIds.has(id)))

    for (const addon of addonOfferings) {
      const a = addon as any
      const parents = (a.attaches_to_offering_ids ?? []) as string[]
      const eligible = await loadEligibleProperties(db, accountId, clientId, parents)
      // Are any eligible properties WITHOUT a cohort assignment?
      const { data: existing } = await db
        .from('addon_cohort_assignments')
        .select('service_location_id')
        .eq('service_offering_id', a.id)
        .eq('client_id', clientId)
      const assigned = new Set((existing ?? []).map((x: any) => x.service_location_id))
      const unassigned = eligible.filter((e) => !assigned.has(e.service_location_id))
      if (unassigned.length > 0) {
        await applyCohortAssignments(db, {
          account_id: accountId,
          client_id: clientId,
          service_offering_id: a.id,
          cohort_total: Math.max(1, Math.round(Number(a.visit_interval_years ?? 1))),
          start_year: (body.cycle_start_year as number | undefined) ?? new Date().getUTCFullYear(),
          method: 'geographic',
          preserve_existing: true,
          eligible_properties: eligible,
        })
      }
    }

    // Now load addon cohort assignments for the routed SLs.
    const { data: cohortRows } = await db
      .from('addon_cohort_assignments')
      .select('id, service_location_id, service_offering_id, cohort_index, next_due_year')
      .in('service_location_id', routed.map((r) => r.sl.id))

    // Load constraints for the routed SLs.
    const { data: constraintRows } = await db
      .from('service_location_constraints')
      .select('id, service_location_id, constraint_type, enforcement, config, notes')
      .in('service_location_id', routed.map((r) => r.sl.id))
    const constraintsBySl = new Map<string, StoredConstraint[]>()
    for (const c of constraintRows ?? []) {
      const arr = constraintsBySl.get((c as any).service_location_id) ?? []
      arr.push(c as StoredConstraint)
      constraintsBySl.set((c as any).service_location_id, arr)
    }

    // Compute per-SL hours_per_visit using existing property-hours pipeline.
    const allOfferingMap = await loadAccountOfferings(db, accountId, clientId)
    // Property-hours expects properties with their service_locations attached.
    const propIds = Array.from(new Set(routed.map((r) => r.sl.property_id)))
    const PROP_CHUNK = 250
    const PROP_PAGE = 1000
    const propRows: any[] = []
    for (let i = 0; i < propIds.length; i += PROP_CHUNK) {
      const idChunk = propIds.slice(i, i + PROP_CHUNK)
      let pageOffset = 0
      for (let p = 0; p < 50; p++) {
        const { data } = await db
          .from('properties')
          .select('*, service_locations(*)')
          .in('id', idChunk)
          .range(pageOffset, pageOffset + PROP_PAGE - 1)
        const batch = data ?? []
        propRows.push(...batch)
        if (batch.length < PROP_PAGE) break
        pageOffset += PROP_PAGE
      }
    }
    const visits = computePropertyVisitHours(
      (propRows ?? []) as any,
      allOfferingMap,
      {
        project_clean_base_hours: constraints.project_clean_base_hours,
        project_clean_hours_per_sqft: constraints.project_clean_hours_per_sqft,
        upholstery_solo_hours: constraints.upholstery_solo_hours,
        upholstery_combo_hours_pct: constraints.upholstery_combo_hours_pct,
        visits_per_year_default: constraints.visits_per_year_default ?? 2,
      }
    )
    const visitsByPropId = new Map<string, { hours_per_visit: number }>()
    for (const v of visits) visitsByPropId.set(v.property.id, { hours_per_visit: v.hours_per_visit })

    const propertiesForBuild: PropertyForBuild[] = routed.map((r) => {
      const propVisit = visitsByPropId.get(r.sl.property_id)
      const slSqft = r.sl.serviceable_sqft ?? 0
      const propRow = (propRows as any)?.find((p: any) => p.id === r.sl.property_id)
      const allSlForProp = propRow?.service_locations ?? []
      const totalSqft = allSlForProp.reduce((s: number, x: any) => s + (x.serviceable_sqft ?? 0), 0)
      const ratio = totalSqft > 0 ? slSqft / totalSqft : 1 / Math.max(1, allSlForProp.length)
      const baseHours = r.sl.hours_per_visit_override ?? (propVisit ? propVisit.hours_per_visit * ratio : 1)

      // Eligible addons for this property
      const eligibleAddons = []
      for (const addon of addonOfferings) {
        const a = addon as any
        const parents = (a.attaches_to_offering_ids ?? []) as string[]
        if (!parents.includes(r.offering.id)) continue
        const cohort = (cohortRows ?? []).find((c: any) =>
          c.service_location_id === r.sl.id && c.service_offering_id === a.id
        ) as any
        if (!cohort) continue
        // Estimate hours_addition = a fraction of base_hours; for upholstery
        // we use upholstery_solo_hours from constraints as a baseline.
        const hoursAddition = constraints.upholstery_solo_hours
        eligibleAddons.push({
          cohort_assignment_id: cohort.id,
          offering_id: a.id,
          offering_name: a.name,
          visit_interval_years: Number(a.visit_interval_years ?? 0),
          hours_addition: hoursAddition,
          cohort_index: cohort.cohort_index,
          next_due_year: cohort.next_due_year,
        })
      }

      return {
        service_location_id: r.sl.id,
        property_id: r.sl.property_id,
        address: formatAddress(propRow),
        lat: Number(propRow?.latitude ?? NaN),
        lng: Number(propRow?.longitude ?? NaN),
        parent_offering_id: r.offering.id,
        parent_offering_name: r.offering.name,
        parent_visit_interval_years: Number(r.offering.visit_interval_years ?? 0.5),
        base_hours_per_visit: baseHours,
        // Phase 4.3 — sqft is the sum of all SLs at this property (so a
        // multi-SL property is represented as the whole building for the
        // pairing-rule check).
        serviceable_sqft: totalSqft,
        constraints: constraintsBySl.get(r.sl.id) ?? [],
        building_size_class_override:
          (r.sl as any).building_size_class_override ?? null,
        eligible_addons: eligibleAddons,
      }
    }).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))

    // Insert template row up front in 'optimizing' state.
    const cycleStartYear = (body.cycle_start_year as number | undefined) ?? new Date().getUTCFullYear()
    const customCycleDays = body.custom_cycle_length_days as number | undefined
    const planningMode = (body.planning_mode as string | undefined) ?? 'auto'
    const name = (body.name as string | undefined) ?? `Template ${new Date().toISOString().slice(0, 10)}`

    const { data: tplRow, error: insertErr } = await db
      .from('routing_templates')
      .insert({
        account_id: accountId,
        client_id: clientId,
        name,
        description: (body.description as string | undefined) ?? null,
        routed_service_location_ids: propertiesForBuild.map((p) => p.service_location_id),
        crew_count: crewCount,
        branches,
        config: {
          crew_size: constraints.crew_size,
          hours_per_day: constraints.hours_per_day,
          drive_speed_mph: constraints.drive_speed_mph,
          ...((body.config as any) ?? {}),
        },
        planning_mode: planningMode,
        cycle_length_days: 0,
        cycle_length_label: 'pending',
        is_custom_cycle_length: !!customCycleDays,
        status: 'optimizing',
        created_by: ctx.email ?? ctx.userId ?? null,
      })
      .select('id')
      .single()
    if (insertErr) return res.status(500).json({ error: `Template insert failed: ${insertErr.message}` })
    const templateId = (tplRow as { id: string }).id

    // Run builder
    try {
      const sched = constraints.scheduling_preferences
      const cfg = {
        crew_size: constraints.crew_size,
        hours_per_day: constraints.hours_per_day,
        work_start_time: '08:00',
        work_end_time: '18:00',
        buffer_minutes_per_stop: 15,
        drive_speed_mph: constraints.drive_speed_mph,
        overnight_trigger_one_way_hours: constraints.hotel_cost_config.overnight_trigger_one_way_hours,
        cluster_radius_miles: sched.cluster_radius_miles,
        max_work_hours_per_crew_day: constraints.hotel_cost_config.max_work_hours_per_crew_day,
        fuel_cost_per_mile: constraints.fuel_cost_per_mile,
        hourly_loaded_labor_cost: constraints.hourly_loaded_labor_cost,
        cost_per_night: constraints.hotel_cost_config.cost_per_night,
        per_diem_per_night: constraints.hotel_cost_config.per_diem_per_night,
        in_day_pairing_max_drive_minutes: sched.pairing_max_drive_minutes,
        in_day_pairing_max_combined_sqft: sched.pairing_max_combined_sqft,
        in_day_pairing_max_buildings_per_day: sched.pairing_max_buildings_per_day,
        ...((body.config as any) ?? {}),
      }
      const result = buildRoutingTemplate({
        account_id: accountId,
        client_id: clientId,
        routed_properties: propertiesForBuild,
        branches,
        crew_count: crewCount,
        config: cfg,
        custom_cycle_length_days: customCycleDays,
        preferences: {
          objective: ((body.preferences as any)?.objective as any) ?? 'balanced',
          soft_constraint_weight: ((body.preferences as any)?.soft_constraint_weight as number | undefined) ?? 0.5,
          allow_hard_constraint_violation: ((body.preferences as any)?.allow_hard_constraint_violation as boolean | undefined) ?? false,
        },
        cycle_start_year: cycleStartYear,
      })

      const status = result.total_visits_per_cycle === 0 ? 'failed' : 'active'
      await db
        .from('routing_templates')
        .update({
          status,
          optimized_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          cycle_length_days: result.cycle_length_days,
          cycle_length_label: result.cycle_length_label,
          geographic_clusters: result.geographic_clusters,
          crew_assignments: result.crew_assignments,
          trips: result.trips,
          unplaced_visits: result.unplaced_visits,
          total_visits_required_per_cycle: result.total_visits_required_per_cycle,
          total_visits_per_cycle: result.total_visits_per_cycle,
          total_drive_minutes_per_cycle: result.total_drive_minutes_per_cycle,
          total_work_minutes_per_cycle: result.total_work_minutes_per_cycle,
          total_overnight_nights_per_cycle: result.total_overnight_nights_per_cycle,
          total_drive_miles_per_cycle: result.total_drive_miles_per_cycle,
          total_estimated_cost_per_cycle: result.total_estimated_cost_per_cycle,
          total_estimated_cost_per_year: result.total_estimated_cost_per_year,
          hard_constraint_violations: result.hard_constraint_violations,
          soft_constraint_violations: result.soft_constraint_violations,
          optimization_score: result.optimization_score,
          optimizer_notes: result.optimizer_notes,
          pacing_analysis: result.pacing_analysis,
          warnings: result.warnings,
        })
        .eq('id', templateId)

      const { data: full } = await db.from('routing_templates').select('*').eq('id', templateId).single()
      return res.status(200).json({ template: full })
    } catch (err: any) {
      await db
        .from('routing_templates')
        .update({ status: 'failed', optimizer_notes: err?.message ?? String(err), updated_at: new Date().toISOString() })
        .eq('id', templateId)
      return res.status(500).json({ error: err?.message ?? 'Template build failed', template_id: templateId })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

// Compose "123 Main St, Plano, TX" from a properties row. Falls back
// gracefully when city/state are missing so unplaced rows still
// surface something useful.
function formatAddress(row: any): string {
  if (!row) return ''
  const parts: string[] = []
  if (row.address_line1) parts.push(String(row.address_line1))
  const cityState = [row.city, row.state].filter(Boolean).join(', ')
  if (cityState) parts.push(cityState)
  return parts.join(', ')
}
