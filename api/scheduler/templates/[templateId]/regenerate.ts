// POST /api/scheduler/templates/[templateId]/regenerate
//
// Re-runs buildRoutingTemplate against the same routed_service_location_ids
// + branches the template was originally built from, optionally overriding
// crew_count or config knobs. Writes the new result back into the same
// template row (status flips to 'optimizing' → 'active' or 'failed').
//
// Useful when:
// - The first run produced too many unplaced visits (raise crew_count)
// - User wants to try a different cycle length
// - Config defaults changed and they want a fresh pass
//
// Cycle instances generated from the OLD template snapshot remain
// untouched (their scheduled_visits + crew_day_routes are already
// materialized). Future generate-cycle calls use the new snapshot.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import {
  loadConstraints,
} from '../../../_lib/analysis/operational-constraints.js'
import { loadAccountOfferings } from '../../../_lib/analysis/service-offerings.js'
import { computePropertyVisitHours } from '../../../_lib/analysis/property-hours.js'
import {
  buildRoutingTemplate,
  type PropertyForBuild,
} from '../../../_lib/scheduler/build-routing-template.js'
import {
  applyCohortAssignments,
  loadEligibleProperties,
} from '../../../_lib/scheduler/cohort-assigner.js'
import type { StoredConstraint } from '../../../_lib/scheduler/constraint-evaluator.js'

export const config = { maxDuration: 300 }

interface Body {
  crew_count?: number
  custom_cycle_length_days?: number | null
  config?: Record<string, unknown>
  preferences?: {
    objective?: 'minimize_drive' | 'maximize_utilization' | 'balanced'
    soft_constraint_weight?: number
    allow_hard_constraint_violation?: boolean
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try { await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const templateId = req.query.templateId as string
  const body = (req.body ?? {}) as Body

  const db = createAdminClient()

  const { data: tplRow, error: tplErr } = await db
    .from('routing_templates')
    .select('*')
    .eq('id', templateId)
    .single()
  if (tplErr || !tplRow) return res.status(404).json({ error: 'Template not found' })
  const tpl = tplRow as any

  const accountId = tpl.account_id as string
  const clientId = tpl.client_id as string
  const slIds = (tpl.routed_service_location_ids ?? []) as string[]
  // Combined templates persist combined_client_ids so regenerate can
  // re-fetch offerings across all source clients.
  const combinedClientIds = Array.isArray(tpl.combined_client_ids)
    ? (tpl.combined_client_ids as string[])
    : null
  const allClientIds = combinedClientIds && combinedClientIds.length > 1
    ? combinedClientIds
    : [clientId]
  const crewCount = body.crew_count ?? tpl.crew_count ?? 1
  const customCycleDays = body.custom_cycle_length_days !== undefined
    ? body.custom_cycle_length_days ?? undefined
    : (tpl.is_custom_cycle_length ? tpl.cycle_length_days : undefined)

  const constraints = await loadConstraints(db, accountId, clientId)
  const branches = (tpl.branches ?? []) as Array<{ name: string; lat: number; lng: number }>
  if (branches.length === 0) {
    return res.status(400).json({ error: 'Template has no branches snapshot' })
  }

  // Mark optimizing
  await db
    .from('routing_templates')
    .update({ status: 'optimizing', updated_at: new Date().toISOString() })
    .eq('id', templateId)

  // Re-load offerings + property hours + cohorts. Page through chunks
  // — PostgREST silently caps a single fetch and large clients can
  // exceed it (truncated to 500 in practice).
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
    .select('id, name, is_routed, offering_role, visit_interval_years, attaches_to_offering_ids, uses_cohort_rotation, client_id')
    .in('client_id', allClientIds)
  const offerings = new Map<string, any>()
  for (const o of offeringRows ?? []) offerings.set((o as any).id, o)

  type RoutedRow = { sl: any; offering: any }
  const routed: RoutedRow[] = []
  for (const r of slRows ?? []) {
    const sl = r as any
    const off = offerings.get(sl.service_offering_id)
    if (off?.is_routed && off.offering_role === 'parent') routed.push({ sl, offering: off })
  }

  // Re-ensure cohorts
  const parentOfferingIds = new Set(routed.map((r) => r.offering.id))
  const addonOfferings = (offeringRows ?? []).filter((o: any) =>
    o.is_routed &&
    o.offering_role === 'addon' &&
    ((o.attaches_to_offering_ids ?? []) as string[]).some((id) => parentOfferingIds.has(id))
  )
  for (const addon of addonOfferings) {
    const a = addon as any
    const eligible = await loadEligibleProperties(db, accountId, clientId, (a.attaches_to_offering_ids ?? []) as string[])
    const existing: any[] = []
    for (let p = 0; p < 50; p++) {
      const { data: batch } = await db
        .from('addon_cohort_assignments')
        .select('service_location_id')
        .eq('service_offering_id', a.id)
        .eq('client_id', clientId)
        .range(p * 1000, p * 1000 + 999)
      const rows = batch ?? []
      existing.push(...rows)
      if (rows.length < 1000) break
    }
    const assigned = new Set(existing.map((x: any) => x.service_location_id))
    const unassigned = eligible.filter((e) => !assigned.has(e.service_location_id))
    if (unassigned.length > 0) {
      await applyCohortAssignments(db, {
        account_id: accountId,
        client_id: clientId,
        service_offering_id: a.id,
        cohort_total: Math.max(1, Math.round(Number(a.visit_interval_years ?? 1))),
        start_year: new Date().getUTCFullYear(),
        method: 'geographic',
        preserve_existing: true,
        eligible_properties: eligible,
      })
    }
  }
  // Chunk + page — combined templates can have 5000+ routed SLs and an
  // unchunked .in() either truncates at the 1000-row PostgREST cap or
  // 414s on URL length.
  const routedSlIds = routed.map((r) => r.sl.id)
  const ID_CHUNK = 250
  const RESULT_PAGE = 1000
  const cohortRows: any[] = []
  for (let i = 0; i < routedSlIds.length; i += ID_CHUNK) {
    const idChunk = routedSlIds.slice(i, i + ID_CHUNK)
    let pageOffset = 0
    for (let p = 0; p < 50; p++) {
      const { data } = await db
        .from('addon_cohort_assignments')
        .select('id, service_location_id, service_offering_id, cohort_index, next_due_year')
        .in('service_location_id', idChunk)
        .range(pageOffset, pageOffset + RESULT_PAGE - 1)
      const batch = data ?? []
      cohortRows.push(...batch)
      if (batch.length < RESULT_PAGE) break
      pageOffset += RESULT_PAGE
    }
  }
  const constraintRows: any[] = []
  for (let i = 0; i < routedSlIds.length; i += ID_CHUNK) {
    const idChunk = routedSlIds.slice(i, i + ID_CHUNK)
    let pageOffset = 0
    for (let p = 0; p < 50; p++) {
      const { data } = await db
        .from('service_location_constraints')
        .select('id, service_location_id, constraint_type, enforcement, config, notes')
        .in('service_location_id', idChunk)
        .range(pageOffset, pageOffset + RESULT_PAGE - 1)
      const batch = data ?? []
      constraintRows.push(...batch)
      if (batch.length < RESULT_PAGE) break
      pageOffset += RESULT_PAGE
    }
  }
  const constraintsBySl = new Map<string, StoredConstraint[]>()
  for (const c of constraintRows ?? []) {
    const arr = constraintsBySl.get((c as any).service_location_id) ?? []
    arr.push(c as StoredConstraint)
    constraintsBySl.set((c as any).service_location_id, arr)
  }

  const allOfferingMap = await loadAccountOfferings(db, accountId, clientId)
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
  const visits = computePropertyVisitHours(propRows as any, allOfferingMap, {
    project_clean_base_hours: constraints.project_clean_base_hours,
    project_clean_hours_per_sqft: constraints.project_clean_hours_per_sqft,
    upholstery_solo_hours: constraints.upholstery_solo_hours,
    upholstery_combo_hours_pct: constraints.upholstery_combo_hours_pct,
    visits_per_year_default: constraints.visits_per_year_default ?? 2,
  })
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

    const eligibleAddons: PropertyForBuild['eligible_addons'] = []
    for (const addon of addonOfferings) {
      const a = addon as any
      const parents = (a.attaches_to_offering_ids ?? []) as string[]
      if (!parents.includes(r.offering.id)) continue
      const cohort = (cohortRows ?? []).find((c: any) =>
        c.service_location_id === r.sl.id && c.service_offering_id === a.id
      ) as any
      if (!cohort) continue
      eligibleAddons.push({
        cohort_assignment_id: cohort.id,
        offering_id: a.id,
        offering_name: a.name,
        visit_interval_years: Number(a.visit_interval_years ?? 0),
        hours_addition: constraints.upholstery_solo_hours,
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
      serviceable_sqft: totalSqft,
      constraints: constraintsBySl.get(r.sl.id) ?? [],
      building_size_class_override:
        (r.sl as any).building_size_class_override ?? null,
      eligible_addons: eligibleAddons,
    }
  })

  // Same split as the create path: missing-coords properties get
  // surfaced as unplaced rather than silently dropped.
  const propertiesMissingCoords = propertiesForBuild.filter(
    (p) => !Number.isFinite(p.lat) || !Number.isFinite(p.lng)
  )
  const propertiesForEngine = propertiesForBuild.filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
  )

  try {
    const tplConfig = (tpl.config ?? {}) as Record<string, unknown>
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
      in_day_pairing_max_drive_minutes: sched.pairing_max_drive_minutes,
      in_day_pairing_max_combined_sqft: sched.pairing_max_combined_sqft,
      in_day_pairing_max_buildings_per_day: sched.pairing_max_buildings_per_day,
      max_work_hours_per_crew_day: constraints.hotel_cost_config.max_work_hours_per_crew_day,
      fuel_cost_per_mile: constraints.fuel_cost_per_mile,
      hourly_loaded_labor_cost: constraints.hourly_loaded_labor_cost,
      cost_per_night: constraints.hotel_cost_config.cost_per_night,
      per_diem_per_night: constraints.hotel_cost_config.per_diem_per_night,
      ...tplConfig,
      ...(body.config ?? {}),
    }
    const result = buildRoutingTemplate({
      account_id: accountId,
      client_id: clientId,
      routed_properties: propertiesForEngine,
      branches,
      crew_count: crewCount,
      config: cfg as any,
      custom_cycle_length_days: customCycleDays,
      preferences: {
        objective: body.preferences?.objective ?? 'balanced',
        soft_constraint_weight: body.preferences?.soft_constraint_weight ?? 0.5,
        allow_hard_constraint_violation: body.preferences?.allow_hard_constraint_violation ?? false,
      },
      cycle_start_year: new Date().getUTCFullYear(),
      branch_assignment_overrides:
        (tpl.branch_assignment_overrides as Record<string, number> | null) ?? undefined,
    })

    if (propertiesMissingCoords.length > 0) {
      const missingPropIds = Array.from(
        new Set(propertiesMissingCoords.map((p) => p.property_id))
      )
      const enrichmentInfo = new Map<string, { status: string | null; errors: any; last: string | null }>()
      for (let i = 0; i < missingPropIds.length; i += 250) {
        const chunk = missingPropIds.slice(i, i + 250)
        const { data } = await db
          .from('properties')
          .select('id, enrichment_status, enrichment_errors, last_enriched_at')
          .in('id', chunk)
        for (const r of (data ?? []) as any[]) {
          enrichmentInfo.set(r.id, {
            status: r.enrichment_status ?? null,
            errors: r.enrichment_errors ?? null,
            last: r.last_enriched_at ?? null,
          })
        }
      }
      const formatErr = (info: { status: string | null; errors: any; last: string | null } | undefined) => {
        if (!info) return 'No enrichment record found for this property.'
        const errMsg =
          info.errors?.geocode ??
          info.errors?.error ??
          (typeof info.errors === 'string' ? info.errors : null)
        const stamp = info.last ? ` (last attempted ${info.last.slice(0, 10)})` : ''
        if (info.status === 'failed') {
          return `Enrichment failed${stamp}: ${errMsg ?? 'unknown error — re-run enrichment to capture details.'}`
        }
        if (info.status === 'pending') {
          return `Pending enrichment — never been geocoded${stamp}. Run enrichment from the Map page or property detail.`
        }
        return `Status: ${info.status ?? 'unknown'}${stamp}. ${errMsg ?? 'No coordinates and no error logged — likely never enriched.'}`
      }
      const missingUnplaced = propertiesMissingCoords.map((p) => ({
        service_location_id: p.service_location_id,
        property_id: p.property_id,
        address: p.address,
        reason: 'not_geocoded',
        detail: formatErr(enrichmentInfo.get(p.property_id)),
      }))
      result.unplaced_visits = [...(result.unplaced_visits ?? []), ...missingUnplaced]
      result.total_visits_required_per_cycle += propertiesMissingCoords.length
    }

    const status = result.total_visits_per_cycle === 0 ? 'failed' : 'active'
    await db
      .from('routing_templates')
      .update({
        status,
        crew_count: crewCount,
        config: cfg,
        is_custom_cycle_length: !!customCycleDays,
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
        branch_assignments: result.branch_assignments,
      })
      .eq('id', templateId)
    const { data: full } = await db.from('routing_templates').select('*').eq('id', templateId).single()
    return res.status(200).json({ template: full })
  } catch (err: any) {
    await db
      .from('routing_templates')
      .update({ status: 'failed', optimizer_notes: err?.message ?? String(err), updated_at: new Date().toISOString() })
      .eq('id', templateId)
    return res.status(500).json({ error: err?.message ?? 'Regenerate failed' })
  }
}

function formatAddress(row: any): string {
  if (!row) return ''
  const parts: string[] = []
  if (row.address_line1) parts.push(String(row.address_line1))
  const cityState = [row.city, row.state].filter(Boolean).join(', ')
  if (cityState) parts.push(cityState)
  return parts.join(', ')
}
