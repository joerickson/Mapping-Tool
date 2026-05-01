// POST /api/analyses/[accountId]/crew-strategy
// Compares three crew structuring options and returns full economics for each.
//   A: Roving — variable-cost, paid for actual work hours
//   B: Dedicated — N+1 crews paid full-time, lower utilization
//   C: Surge — 3 FT + 3 surge crews for half the year
// Reference: JLL Red River Excel methodology.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../../../_lib/supabase.js'
import { authenticateRequest } from '../../../../../_lib/auth.js'
import {
  loadAccountProperties,
  createAnalysisRecord,
  completeAnalysisRecord,
  failAnalysisRecord,
  type AccountProperty,
} from '../../../../../_lib/analysis/account-data.js'
import {
  loadAccountOfferings,
  classifyOffering,
} from '../../../../../_lib/analysis/service-offerings.js'
import { haversineMiles, type LatLng } from '../../../../../_lib/analysis/haversine.js'
import {
  loadConstraints,
  applyExclusions,
  requireSelectedBranches,
  NO_SELECTION_ERROR,
} from '../../../../../_lib/analysis/operational-constraints.js'
import { nearestCity, populationBand } from '../../../../../_lib/analysis/constrained-kmeans.js'
import { regionForState } from '../../../../../_lib/analysis/regions.js'
import { computePropertyVisitHours } from '../../../../../_lib/analysis/property-hours.js'
import {
  calculateOvernights,
  type OvernightConfig,
  type OvernightResult,
} from '../../../../../_lib/analysis/overnight-calculator.js'
import { computeCrewCount } from '../../../../../_lib/analysis/crew-count.js'
import type { BuildingSizeClass } from '../../../../../_lib/analysis/building-size.js'

// Status enum for utilization band evaluation. Order matters for severity:
// 'overcapacity' > 'underutilized' > 'acceptable' > 'ideal'.
type UtilStatus = 'ideal' | 'acceptable' | 'underutilized' | 'overcapacity'

function classifyUtilization(
  pct: number,
  band: { hard_floor_pct: number; soft_ceiling_pct: number; ideal_min_pct: number; ideal_max_pct: number }
): UtilStatus {
  if (pct < band.hard_floor_pct) return 'underutilized'
  if (pct > band.soft_ceiling_pct) return 'overcapacity'
  if (pct >= band.ideal_min_pct && pct <= band.ideal_max_pct) return 'ideal'
  return 'acceptable'
}

export const config = { maxDuration: 60 }

export interface CrewStrategyInputs {
  client_id?: string | null
  k: number | null
  branches: Array<{
    name: string
    lat: number
    lng: number
    property_count?: number
    population?: number | null
    state?: string | null
  }> | null
  crew_size: number
  hours_per_day: number
  hourly_loaded_labor_cost: number
  project_clean_base_hours: number
  project_clean_hours_per_sqft: number
  upholstery_solo_hours: number
  upholstery_combo_hours_pct: number
  visits_per_year_default: number
  surge_weeks_per_year: number
  surge_crew_count: number
  surge_premium_multiplier: number
  fuel_cost_per_mile: number
  vehicles_per_crew: number
  drive_speed_mph: number
  utilization_constraint: {
    enabled: boolean
    hard_floor_pct: number
    soft_ceiling_pct: number
    ideal_min_pct: number
    ideal_max_pct: number
    scope: 'per_branch' | 'per_region' | 'portfolio'
  }
  // Phase 4 follow-up — used to derive FTE capacity from the user's
  // actual config (working_days_per_year × hours_per_day) instead of
  // a hardcoded 47 × 40 = 1880 that assumed 8-hour days.
  working_days_per_year?: number | null
}

// FTE capacity is now derived per-call from
// constraints.working_days_per_year × constraints.hours_per_day so
// utilization scales with the user's actual day length (default
// 250 × 10 = 2500, not the legacy 47 × 40 = 1880 which assumed
// 8-hour days and overstated utilization by ~33%).
const DEFAULT_WORKING_DAYS_PER_YEAR = 250
const ROVING_ESTIMATED_ANNUAL_MILES_PER_CREW = 30000

function computeFteHoursPerYear(inputs: { hours_per_day: number }, workingDaysPerYear?: number | null): number {
  const days = Number.isFinite(workingDaysPerYear) && (workingDaysPerYear ?? 0) > 0
    ? Number(workingDaysPerYear)
    : DEFAULT_WORKING_DAYS_PER_YEAR
  const hpd = Number.isFinite(inputs.hours_per_day) && inputs.hours_per_day > 0
    ? inputs.hours_per_day
    : 8
  return days * hpd
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let ctx: Awaited<ReturnType<typeof authenticateRequest>>
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const accountId = req.query.accountId as string
  const clientId = req.query.clientId as string
  const body = (req.body ?? {}) as Partial<CrewStrategyInputs>

  const db = createAdminClient()
  const constraints = await loadConstraints(db, accountId, clientId)

  // Tier 2: requires the user to have confirmed a branch selection.
  const sel = requireSelectedBranches(constraints)
  if (!sel.ok) return res.status(400).json(NO_SELECTION_ERROR)

  const inputs: CrewStrategyInputs = {
    client_id: body.client_id ?? constraints.client_id ?? null,
    k: body.k ?? null,
    branches: body.branches ?? null,
    crew_size: body.crew_size ?? constraints.crew_size,
    hours_per_day: body.hours_per_day ?? constraints.hours_per_day,
    hourly_loaded_labor_cost:
      body.hourly_loaded_labor_cost ?? constraints.hourly_loaded_labor_cost,
    project_clean_base_hours:
      body.project_clean_base_hours ?? constraints.project_clean_base_hours,
    project_clean_hours_per_sqft:
      body.project_clean_hours_per_sqft ?? constraints.project_clean_hours_per_sqft,
    upholstery_solo_hours: body.upholstery_solo_hours ?? constraints.upholstery_solo_hours,
    upholstery_combo_hours_pct:
      body.upholstery_combo_hours_pct ?? constraints.upholstery_combo_hours_pct,
    visits_per_year_default: body.visits_per_year_default ?? 2,
    surge_weeks_per_year: body.surge_weeks_per_year ?? constraints.surge_weeks_per_year,
    surge_crew_count: body.surge_crew_count ?? constraints.surge_crew_count,
    surge_premium_multiplier:
      body.surge_premium_multiplier ?? constraints.surge_premium_multiplier,
    fuel_cost_per_mile: body.fuel_cost_per_mile ?? constraints.fuel_cost_per_mile,
    vehicles_per_crew: body.vehicles_per_crew ?? constraints.vehicles_per_crew,
    drive_speed_mph: body.drive_speed_mph ?? constraints.drive_speed_mph,
    utilization_constraint:
      (body as any).utilization_constraint ?? constraints.utilization_constraint,
    working_days_per_year: constraints.working_days_per_year ?? null,
  }

  let analysisId: string
  try {
    analysisId = await createAnalysisRecord(db, {
      account_id: accountId,
      client_id: clientId,
      module_key: 'crew_strategy',
      inputs: inputs as unknown as Record<string, unknown>,
      created_by: ctx.userId ?? null,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message ?? 'Failed to create analysis record' })
  }

  try {
    const allProperties = await loadAccountProperties(db, accountId, clientId)
    const properties = applyExclusions(allProperties, constraints.excluded_property_ids)
    const offerings = await loadAccountOfferings(db, accountId, clientId)

    // Tier 2 always uses the user's confirmed selection. Body.branches is
    // ignored — selection takes precedence per Phase 2.5b spec.
    const branches = sel.branches.map((b) => ({
      name: b.name,
      lat: b.lat,
      lng: b.lng,
    }))
    const kUsed = constraints.selected_k ?? branches.length

    // Phase 3.7 — overnight cost is identical across A/B/C (same properties,
    // same branches; what differs is the crew structure, not the work
    // location). Compute once, attach to each option's summary.
    const visits = computePropertyVisitHours(properties, offerings, {
      project_clean_base_hours: inputs.project_clean_base_hours,
      project_clean_hours_per_sqft: inputs.project_clean_hours_per_sqft,
      upholstery_solo_hours: inputs.upholstery_solo_hours,
      upholstery_combo_hours_pct: inputs.upholstery_combo_hours_pct,
      visits_per_year_default: inputs.visits_per_year_default,
    })
    const overnightConfig: OvernightConfig = {
      drive_speed_mph: constraints.drive_speed_mph,
      overnight_trigger_one_way_hours:
        constraints.hotel_cost_config.overnight_trigger_one_way_hours,
      max_work_hours_per_crew_day:
        constraints.hotel_cost_config.max_work_hours_per_crew_day,
      buffer_hours_per_day: constraints.hotel_cost_config.buffer_hours_per_day,
      crew_size: inputs.crew_size,
      cost_per_night: constraints.hotel_cost_config.cost_per_night,
      per_diem_per_night: constraints.hotel_cost_config.per_diem_per_night,
      include_per_diem: constraints.hotel_cost_config.include_per_diem,
    }
    const overnight = calculateOvernights(
      visits
        .filter(
          (v) =>
            v.property.latitude != null &&
            v.property.longitude != null &&
            v.hours_per_visit > 0
        )
        .map((v) => ({
          id: v.property.id,
          address: v.property.address_line1,
          lat: v.property.latitude as number,
          lng: v.property.longitude as number,
          visits_per_year: v.visits_per_year,
          hours_per_visit: v.hours_per_visit,
        })),
      branches,
      overnightConfig
    )

    const result = computeCrewStrategy(properties, offerings, branches, kUsed, inputs, overnight)

    await completeAnalysisRecord(db, analysisId, {
      outputs: result.outputs,
      summary_text: result.summary_text,
      property_count: properties.length,
    })
    return res.status(200).json({ analysis_id: analysisId, status: 'completed' })
  } catch (err: any) {
    const msg = err?.message ?? String(err)
    await failAnalysisRecord(db, analysisId, msg)
    return res.status(500).json({ analysis_id: analysisId, status: 'failed', error: msg })
  }
}

export function computeCrewStrategy(
  properties: AccountProperty[],
  offerings: Map<string, { id: string; name: string }>,
  branches: Array<{ name: string; lat: number; lng: number; property_count?: number }>,
  kUsed: number,
  inputs: CrewStrategyInputs,
  overnight?: OvernightResult
) {
  const fteHoursPerYear = computeFteHoursPerYear(
    inputs,
    inputs.working_days_per_year ?? null
  )
  // ── Per-property work hours per year ──────────────────────────────────────
  // For each property we want total annual project-crew hours. A property may
  // have multiple service_locations (e.g. project clean + upholstery for the
  // same building). The upholstery_combo rule applies when both exist.

  type PropertyHours = {
    property: AccountProperty
    annual_hours: number
    branch_idx: number // index into branches[]
    drive_miles_one_way: number
    is_branch_override: boolean
  }

  const perProperty: PropertyHours[] = []
  // Phase 3.8 — per-visit list for building-count crew math.
  const routedVisits: Array<{
    service_location_id: string
    hours_per_visit: number
    building_size_class_override?: BuildingSizeClass | null
    branch_idx: number
  }> = []
  let totalAnnualHours = 0
  let totalProjectHours = 0
  let propertiesMissingCoords = 0

  for (const p of properties) {
    // Detect whether this property has both project clean and upholstery —
    // the combo rule increases project clean time by upholstery_combo_hours_pct.
    let hasProjectClean = false
    let hasUpholstery = false
    for (const sl of p.service_locations) {
      const offering = sl.service_offering_id ? offerings.get(sl.service_offering_id) : null
      const cls = offering ? classifyOffering(offering.name) : 'other'
      if (cls === 'project_clean') hasProjectClean = true
      if (cls === 'upholstery') hasUpholstery = true
    }

    let propAnnualHours = 0
    // Property-level aggregation for the building-count math: a single
    // physical building (= property) consumes one crew-day per visit
    // regardless of how many service_locations model it. Combo upholstery
    // is folded into the project_clean SL's hpv, so we skip it here to
    // avoid phantom 1-hour visits.
    let propertyVisitsPerYear = 0
    let propertyHoursPerVisit = 0
    let propertyOverride: BuildingSizeClass | null = null
    for (const sl of p.service_locations) {
      const offering = sl.service_offering_id ? offerings.get(sl.service_offering_id) : null
      const cls = offering ? classifyOffering(offering.name) : 'other'

      // Crew Strategy is project-crew workforce only. Skip recurring janitorial
      // (covered by Workforce Sizing module) and uncategorized "other".
      if (cls !== 'project_clean' && cls !== 'upholstery') continue

      const sqft = sl.serviceable_sqft ?? 0
      const visits = sl.visits_per_year_override ?? inputs.visits_per_year_default

      let hoursPerVisit = 0
      if (cls === 'project_clean') {
        hoursPerVisit = inputs.project_clean_base_hours + sqft * inputs.project_clean_hours_per_sqft
        if (hasUpholstery) hoursPerVisit *= 1 + inputs.upholstery_combo_hours_pct
      } else if (cls === 'upholstery') {
        // Standalone upholstery (no project clean at this property) uses the
        // solo hours; combo is already accounted for above.
        if (!hasProjectClean) hoursPerVisit = inputs.upholstery_solo_hours
      }

      // Existing hours-based bookkeeping uses the Math.max bump for safety.
      const hpvForBookkeeping = Math.max(hoursPerVisit, 1)
      propAnnualHours += hpvForBookkeeping * visits

      // Building-count math: only fold this SL into the property if it
      // contributes real work. Skip combo-upholstery phantoms (hpv = 0).
      if (hoursPerVisit > 0) {
        propertyHoursPerVisit += hoursPerVisit
        if (visits > propertyVisitsPerYear) propertyVisitsPerYear = visits
      }
      const slOverride =
        (sl.building_size_class_override as BuildingSizeClass | null | undefined) ?? null
      if (slOverride && !propertyOverride) propertyOverride = slOverride
    }

    // Phase 3.9a — manual branch_override on the property wins over the
    // nearest-branch heuristic. Falls back to nearest if the override
    // doesn't match a currently-selected branch.
    let bestIdx = 0
    let bestDistMi = 0
    let usedOverride = false
    if (p.branch_override) {
      const idx = branches.findIndex(
        (b) => b.name.toLowerCase() === (p.branch_override as string).toLowerCase()
      )
      if (idx >= 0) {
        bestIdx = idx
        usedOverride = true
        if (p.latitude != null && p.longitude != null) {
          bestDistMi = haversineMiles(
            { lat: p.latitude, lng: p.longitude },
            { lat: branches[idx].lat, lng: branches[idx].lng }
          )
        }
      }
    }
    if (!usedOverride) {
      if (p.latitude != null && p.longitude != null) {
        const me: LatLng = { lat: p.latitude, lng: p.longitude }
        let bestDist = Infinity
        for (let i = 0; i < branches.length; i++) {
          const d = haversineMiles(me, { lat: branches[i].lat, lng: branches[i].lng })
          if (d < bestDist) {
            bestDist = d
            bestIdx = i
          }
        }
        bestDistMi = bestDist
      } else {
        propertiesMissingCoords += 1
      }
    }

    // Emit one routed_visit per (property × visit) — operational reality
    // is "the crew shows up at the building this many times per year",
    // not "the crew shows up per SL per visit". branch_idx attribution
    // lets us split into per-branch counts for Option B.
    if (propertyHoursPerVisit > 0 && propertyVisitsPerYear > 0) {
      for (let v = 0; v < propertyVisitsPerYear; v++) {
        routedVisits.push({
          service_location_id: p.id,
          hours_per_visit: propertyHoursPerVisit,
          building_size_class_override: propertyOverride,
          branch_idx: bestIdx,
        })
      }
    }

    perProperty.push({
      property: p,
      annual_hours: propAnnualHours,
      branch_idx: bestIdx,
      drive_miles_one_way: bestDistMi,
      is_branch_override: usedOverride,
    })
    totalAnnualHours += propAnnualHours
    totalProjectHours += propAnnualHours
  }

  // ── Per-branch aggregation (for Option B) ─────────────────────────────────
  const branchHours = new Array(branches.length).fill(0)
  const branchPropCount = new Array(branches.length).fill(0)
  const branchDriveSum = new Array(branches.length).fill(0)
  const branchDriveCount = new Array(branches.length).fill(0)
  const branchOverrideCount = new Array(branches.length).fill(0)
  for (const ph of perProperty) {
    branchHours[ph.branch_idx] += ph.annual_hours
    branchPropCount[ph.branch_idx] += 1
    if (ph.drive_miles_one_way > 0) {
      branchDriveSum[ph.branch_idx] += ph.drive_miles_one_way
      branchDriveCount[ph.branch_idx] += 1
    }
    if (ph.is_branch_override) branchOverrideCount[ph.branch_idx] += 1
  }

  // ── Phase 3.8 — Building-count crew math (replaces hours-based) ──────────
  // 1 building = 1 crew-day (default), with small-property pairing as the
  // optimistic ceiling. Uses actual working days, not 5/7 of calendar.
  const crewCountAnalysis = computeCrewCount({
    routed_visits: routedVisits,
    cycle_length_days: 365,
    cycles_per_year: 1,
  })
  // Per-branch slice for Option B (each branch's crews scale with its own
  // building-day workload).
  const crewCountPerBranchFull = branches.map((_, i) => {
    const branchVisits = routedVisits.filter((v) => v.branch_idx === i)
    if (branchVisits.length === 0) {
      return {
        conservative: 1,
        optimistic: 1,
        building_days: 0,
        working_days: crewCountAnalysis.conservative.working_days_per_cycle,
      }
    }
    const a = computeCrewCount({
      routed_visits: branchVisits,
      cycle_length_days: 365,
      cycles_per_year: 1,
    })
    return {
      conservative: a.conservative.crews_needed,
      optimistic: a.optimistic.crews_needed,
      building_days: a.conservative.total_crew_days_per_cycle,
      working_days: a.conservative.working_days_per_cycle,
    }
  })
  const crewCountPerBranch = crewCountPerBranchFull
  // Phase 4 follow-up — utilization is now BUILDING-DAY based, not
  // hours-based. A crew can only do one building per day (with small-
  // property pairing as the optimistic ceiling), so dividing total
  // hours by total available hours gave a meaningless number — the
  // crew might work 6 hours and still have used the entire day's
  // capacity because they can't drive to a second building.
  const annualBuildingDays =
    crewCountAnalysis.conservative.total_crew_days_per_cycle *
    (crewCountAnalysis.cycles_per_year ?? 1)
  const annualBuildingDaysOptimistic =
    crewCountAnalysis.optimistic.total_crew_days_per_cycle *
    (crewCountAnalysis.cycles_per_year ?? 1)
  const workingDaysPerYearForUtil =
    Number.isFinite(inputs.working_days_per_year) && (inputs.working_days_per_year ?? 0) > 0
      ? Number(inputs.working_days_per_year)
      : DEFAULT_WORKING_DAYS_PER_YEAR

  // ── Option A: Roving ──────────────────────────────────────────────────────
  // Variable cost — paid only for hours worked. Crew count comes from the
  // building-count math (conservative); cost is hours-based regardless.
  const optionA_crews = crewCountAnalysis.conservative.crews_needed
  const optionA_crews_optimistic = crewCountAnalysis.optimistic.crews_needed
  const optionA_labor =
    totalAnnualHours * inputs.hourly_loaded_labor_cost * inputs.crew_size
  // Building-day utilization: how many crew-days of work do we have
  // vs how many workdays we're paying the crews to be available?
  // Pairing-aware (uses optimistic count if it pulled small buildings
  // together) since paired days only count as 1 used day.
  const optionA_util_pct =
    optionA_crews > 0
      ? Math.min(
          100,
          Math.round(
            (annualBuildingDaysOptimistic /
              (optionA_crews * workingDaysPerYearForUtil)) *
              100
          )
        )
      : 0
  const optionA_vehicle =
    optionA_crews *
    inputs.vehicles_per_crew *
    ROVING_ESTIMATED_ANNUAL_MILES_PER_CREW *
    inputs.fuel_cost_per_mile

  // ── Branch population lookup ──────────────────────────────────────────────
  // Cross-reference each branch with the cities dataset by lat/lng to attach
  // population + state so per-region grouping and the UI can show populations.
  const branchMeta = branches.map((b) => {
    const nc = nearestCity(b.lat, b.lng)
    return {
      name: b.name,
      lat: b.lat,
      lng: b.lng,
      population: nc?.population ?? null,
      state_id: nc?.state_id ?? null,
      region: nc?.state_id ? regionForState(nc.state_id) : 'Other',
      // "Houston, TX" for the UI to render regardless of what the user named
      // their branch in the selection workflow. Falls back to the raw name
      // when no nearby city is in the dataset.
      city_state: nc ? `${nc.city}, ${nc.state_id}` : b.name,
    }
  })

  // ── Option B: Dedicated — size each branch from building-count math ──────
  // Each branch gets ceil(branch_building_days / branch_working_days).
  // The utilization band is no longer the primary driver — it survives
  // below as informational annotation on the per-branch breakdown.
  const band = inputs.utilization_constraint
  const bandActive = band.enabled
  const crewsPerBranch = crewCountPerBranch.map((c) => Math.max(1, c.conservative))
  const crewsPerBranchOptimistic = crewCountPerBranch.map((c) => Math.max(1, c.optimistic))
  const optionB_crews = crewsPerBranch.reduce((a: number, b: number) => a + b, 0)
  const optionB_crews_optimistic = crewsPerBranchOptimistic.reduce(
    (a: number, b: number) => a + b,
    0
  )

  const optionB_labor =
    optionB_crews * fteHoursPerYear * inputs.hourly_loaded_labor_cost * inputs.crew_size

  // Per-branch utilization rows for output.
  let optionB_util_sum = 0
  let optionB_util_count = 0
  const optionB_branch_breakdown: Array<{
    branch_name: string
    city_state: string
    population: number | null
    crew_count: number
    crew_count_optimistic: number
    work_hours: number
    available_hours: number
    utilization_pct: number
    property_count: number
    avg_drive_miles_one_way: number
    avg_drive_minutes_one_way: number
    override_property_count: number
    status: UtilStatus
    warning?: string | null
    surge_recommendation?: { surge_crews: number; surge_weeks: number } | null
  }> = []
  for (let i = 0; i < branches.length; i++) {
    const crews = crewsPerBranch[i]
    const available = crews * fteHoursPerYear
    // Building-day util per branch — same shift as Option A.
    const branchBuildingDays =
      crewCountPerBranchFull[i]?.building_days ?? 0
    const branchAvailableDays = crews * workingDaysPerYearForUtil
    const utilPct =
      branchAvailableDays > 0
        ? Math.min(100, Math.round((branchBuildingDays / branchAvailableDays) * 100))
        : 0
    const status = classifyUtilization(utilPct, band)
    optionB_util_sum += utilPct
    optionB_util_count += 1

    let warning: string | null = null
    let surge_recommendation: { surge_crews: number; surge_weeks: number } | null = null
    if (status === 'overcapacity') {
      const overflowHours = Math.max(0, branchHours[i] - available)
      const surgeWeeks = Math.max(4, Math.round(overflowHours / (40 * 1)))
      const surgeCrews = Math.max(1, Math.ceil(overflowHours / (surgeWeeks * 40)))
      warning = `${utilPct}% utilization (over ${band.soft_ceiling_pct}% ceiling). Add surge crews or expand the dedicated team.`
      surge_recommendation = { surge_crews: surgeCrews, surge_weeks: Math.min(26, surgeWeeks) }
    } else if (status === 'underutilized') {
      warning = `${utilPct}% utilization (under ${band.hard_floor_pct}% floor). Consider consolidating with an adjacent branch or adding properties.`
    }

    const avgDriveMiles =
      branchDriveCount[i] > 0 ? branchDriveSum[i] / branchDriveCount[i] : 0
    const avgDriveMinutes =
      avgDriveMiles > 0
        ? Math.round((avgDriveMiles / Math.max(1, inputs.drive_speed_mph)) * 60)
        : 0
    optionB_branch_breakdown.push({
      branch_name: branches[i].name,
      city_state: branchMeta[i].city_state,
      population: branchMeta[i].population,
      crew_count: crews,
      crew_count_optimistic: crewsPerBranchOptimistic[i],
      work_hours: Math.round(branchHours[i]),
      available_hours: Math.round(available),
      utilization_pct: utilPct,
      property_count: branchPropCount[i],
      avg_drive_miles_one_way: Math.round(avgDriveMiles * 10) / 10,
      avg_drive_minutes_one_way: avgDriveMinutes,
      override_property_count: branchOverrideCount[i],
      status,
      warning,
      surge_recommendation,
    })
  }
  const optionB_util_pct = optionB_util_count > 0 ? Math.round(optionB_util_sum / optionB_util_count) : 0
  const optionB_vehicle =
    optionB_crews *
    inputs.vehicles_per_crew *
    ROVING_ESTIMATED_ANNUAL_MILES_PER_CREW *
    0.7 *
    inputs.fuel_cost_per_mile

  // ── Option C: Surge model ─────────────────────────────────────────────────
  const hoursPerWeek = inputs.hours_per_day * 5
  const optionC_FT_crews = 3
  const optionC_FT_labor =
    optionC_FT_crews *
    52 *
    hoursPerWeek *
    inputs.hourly_loaded_labor_cost *
    inputs.crew_size
  const optionC_surge_labor =
    inputs.surge_crew_count *
    inputs.surge_weeks_per_year *
    hoursPerWeek *
    inputs.hourly_loaded_labor_cost *
    inputs.surge_premium_multiplier *
    inputs.crew_size
  const optionC_labor = optionC_FT_labor + optionC_surge_labor
  // FT crews handle the steady-state building-day load; surge crews
  // pick up peak periods. Convert surge weeks into building-days
  // (5 working days per week) for the same denominator.
  const optionC_capacity_days =
    optionC_FT_crews * workingDaysPerYearForUtil +
    inputs.surge_crew_count * inputs.surge_weeks_per_year * 5
  const optionC_util_pct =
    optionC_capacity_days > 0
      ? Math.min(99, Math.round((annualBuildingDaysOptimistic / optionC_capacity_days) * 100))
      : 0
  const optionC_vehicle =
    (optionC_FT_crews + inputs.surge_crew_count) *
    inputs.vehicles_per_crew *
    ROVING_ESTIMATED_ANNUAL_MILES_PER_CREW *
    0.85 *
    inputs.fuel_cost_per_mile

  const totalA = optionA_labor + optionA_vehicle
  const totalB = optionB_labor + optionB_vehicle
  const totalC = optionC_labor + optionC_vehicle

  // ── Recommendation ────────────────────────────────────────────────────────
  // - >400 properties + >5 states  → B (defensible, predictable)
  // - >15% labor savings of C vs B → C (only if surge sourcing is reliable;
  //   we don't know that signal, so we still flag C as a serious option)
  // - otherwise                    → B
  const distinctStates = new Set(properties.map((p) => (p.state || '').toUpperCase())).size
  const cVsBSavingsPct = optionB_labor > 0 ? (optionB_labor - optionC_labor) / optionB_labor : 0

  let recommended: 'A' | 'B' | 'C' = 'B'
  let recommendedRationale = ''
  const buildingMath = `${routedVisits.length} building-days ÷ ${crewCountAnalysis.conservative.working_days_per_cycle} working days = ${crewCountAnalysis.conservative.crews_needed} crews (conservative)${
    crewCountAnalysis.optimistic.crews_needed !== crewCountAnalysis.conservative.crews_needed
      ? `, ${crewCountAnalysis.optimistic.crews_needed} with small-property pairing`
      : ''
  }.`
  if (properties.length > 400 && distinctStates > 5) {
    recommended = 'B'
    recommendedRationale = `${properties.length} properties across ${distinctStates} states — Option B (Dedicated) is the most defensible choice for Year 1. ${buildingMath} Predictable operations, simple to staff, and easier to bid against. Consider Option A in Year 2-3 once dispatch is dialed in.`
  } else if (cVsBSavingsPct > 0.15) {
    recommended = 'C'
    recommendedRationale = `Option C saves ${Math.round(
      cVsBSavingsPct * 100
    )}% in labor vs Option B. ${buildingMath} Strong candidate IF surge sourcing is reliable in this region — verify with regional ops before committing.`
  } else {
    recommended = 'B'
    recommendedRationale = `Option B (Dedicated) is the recommended baseline. ${buildingMath} Option C savings are below the 15% threshold needed to justify surge sourcing risk.`
  }

  // ── Per-region rollup for Option B ────────────────────────────────────────
  // Building-day based: aggregate building-days needed across branches
  // in the region, divided by total available crew-days for those
  // branches. work_hours/available_hours kept for display only.
  const regionMap = new Map<
    string,
    {
      branches_in_region: string[]
      work_hours: number
      available_hours: number
      building_days: number
      available_days: number
    }
  >()
  for (let i = 0; i < branches.length; i++) {
    const region = branchMeta[i].region
    const cur =
      regionMap.get(region) ?? {
        branches_in_region: [],
        work_hours: 0,
        available_hours: 0,
        building_days: 0,
        available_days: 0,
      }
    cur.branches_in_region.push(branchMeta[i].city_state)
    cur.work_hours += branchHours[i]
    cur.available_hours += crewsPerBranch[i] * fteHoursPerYear
    cur.building_days += crewCountPerBranchFull[i]?.building_days ?? 0
    cur.available_days += crewsPerBranch[i] * workingDaysPerYearForUtil
    regionMap.set(region, cur)
  }
  const optionB_per_region = Array.from(regionMap.entries()).map(([region, v]) => {
    const utilPct =
      v.available_days > 0
        ? Math.min(100, Math.round((v.building_days / v.available_days) * 100))
        : 0
    return {
      region,
      branches_in_region: v.branches_in_region,
      work_hours: Math.round(v.work_hours),
      available_hours: Math.round(v.available_hours),
      aggregate_utilization_pct: utilPct,
      status: classifyUtilization(utilPct, band),
    }
  })

  const optionB_portfolio_pct =
    optionB_crews > 0
      ? Math.min(
          100,
          Math.round(
            (annualBuildingDays /
              (optionB_crews * workingDaysPerYearForUtil)) *
              100
          )
        )
      : 0
  const optionB_portfolio = {
    crew_count: optionB_crews,
    work_hours: Math.round(totalProjectHours),
    available_hours: optionB_crews * fteHoursPerYear,
    utilization_pct: optionB_portfolio_pct,
    status: classifyUtilization(optionB_portfolio_pct, band),
  }

  // Option A utilization breakdown (portfolio scope only — roving has no
  // branch concept).
  const optionA_portfolio = {
    crew_count: optionA_crews,
    work_hours: Math.round(totalProjectHours),
    available_hours: optionA_crews * fteHoursPerYear,
    utilization_pct: optionA_util_pct,
    status: classifyUtilization(optionA_util_pct, band),
  }

  // Option C: FT crews target the ideal band; surge handles overflow.
  const optionC_portfolio = {
    crew_count: optionC_FT_crews,
    surge_crew_count: inputs.surge_crew_count,
    work_hours: Math.round(totalProjectHours),
    available_hours: optionC_FT_crews * fteHoursPerYear,
    utilization_pct: optionC_util_pct,
    status: classifyUtilization(optionC_util_pct, band),
  }

  // ── Constraint violations (only based on the user's chosen scope) ─────────
  const constraint_violations: Array<{
    scope: 'branch' | 'region' | 'portfolio'
    name: string
    metric: 'utilization_pct'
    actual: number
    threshold_violated: 'hard_floor' | 'soft_ceiling' | 'ideal_min' | 'ideal_max'
    severity: 'warning' | 'flag'
    suggestion: string
  }> = []

  if (bandActive) {
    if (band.scope === 'per_branch') {
      for (const row of optionB_branch_breakdown) {
        if (row.status === 'underutilized') {
          constraint_violations.push({
            scope: 'branch',
            name: row.city_state,
            metric: 'utilization_pct',
            actual: row.utilization_pct,
            threshold_violated: 'hard_floor',
            severity: 'flag',
            suggestion: `Consolidate with adjacent branch or add properties to ${row.city_state}.`,
          })
        } else if (row.status === 'overcapacity') {
          constraint_violations.push({
            scope: 'branch',
            name: row.city_state,
            metric: 'utilization_pct',
            actual: row.utilization_pct,
            threshold_violated: 'soft_ceiling',
            severity: 'warning',
            suggestion: row.surge_recommendation
              ? `Add ${row.surge_recommendation.surge_crews} surge crew${row.surge_recommendation.surge_crews === 1 ? '' : 's'} for ~${row.surge_recommendation.surge_weeks} weeks at ${row.city_state}.`
              : `Add a crew at ${row.city_state}.`,
          })
        }
      }
    } else if (band.scope === 'per_region') {
      for (const r of optionB_per_region) {
        if (r.status === 'underutilized' || r.status === 'overcapacity') {
          constraint_violations.push({
            scope: 'region',
            name: r.region,
            metric: 'utilization_pct',
            actual: r.aggregate_utilization_pct,
            threshold_violated: r.status === 'underutilized' ? 'hard_floor' : 'soft_ceiling',
            severity: r.status === 'overcapacity' ? 'warning' : 'flag',
            suggestion:
              r.status === 'underutilized'
                ? `${r.region} is collectively under ${band.hard_floor_pct}%; consider consolidating branches.`
                : `${r.region} is collectively over ${band.soft_ceiling_pct}%; add surge or new branch.`,
          })
        }
      }
    } else {
      // portfolio scope
      const status = classifyUtilization(optionB_portfolio_pct, band)
      if (status === 'underutilized' || status === 'overcapacity') {
        constraint_violations.push({
          scope: 'portfolio',
          name: 'portfolio',
          metric: 'utilization_pct',
          actual: optionB_portfolio_pct,
          threshold_violated: status === 'underutilized' ? 'hard_floor' : 'soft_ceiling',
          severity: status === 'overcapacity' ? 'warning' : 'flag',
          suggestion:
            status === 'underutilized'
              ? 'Portfolio over-resourced — consider dropping a branch.'
              : 'Portfolio under-resourced — add crews or use Option C surge.',
        })
      }
    }
  }

  // ── Phase 3.7 — overnight summary, identical across options ───────────────
  const largestTrip = (overnight?.trips ?? []).reduce<{
    name: string
    properties: number
    nights: number
  } | null>((best, t) => {
    if (!best || t.properties_in_cluster.length > best.properties) {
      return {
        name: t.cluster_id,
        properties: t.properties_in_cluster.length,
        nights: t.nights_per_trip,
      }
    }
    return best
  }, null)
  const overnightSummary = overnight
    ? {
        total_overnight_nights: overnight.total_overnight_nights_per_year,
        total_overnight_cost: overnight.total_overnight_cost,
        properties_requiring_overnight: overnight.properties_requiring_overnight,
        cluster_count: overnight.trips.length,
        largest_cluster: largestTrip,
      }
    : null

  // ── Output assembly ───────────────────────────────────────────────────────
  const options = {
    A: {
      label: 'Roving Crews',
      crew_count: optionA_crews,
      crew_count_optimistic: optionA_crews_optimistic,
      utilization_pct: optionA_util_pct,
      annual_labor_cost: Math.round(optionA_labor),
      annual_vehicle_cost: Math.round(optionA_vehicle),
      total_annual_cost: Math.round(totalA),
      utilization_breakdown: { portfolio: optionA_portfolio },
      overnight_summary: overnightSummary,
      pros: [
        'Highest utilization — pay only for actual work hours',
        'Flexible — crews go where the demand is',
        'Lowest variable labor cost when work volume is steady',
      ],
      cons: [
        'Requires strong dispatch coordination',
        'Higher travel time per crew',
        'Harder to staff — full-time crews want predictable schedules',
      ],
      recommended_use_case:
        'Mature operations with strong dispatch + consistent year-round volume.',
    },
    B: {
      label: 'Dedicated Crews',
      crew_count: optionB_crews,
      crew_count_optimistic: optionB_crews_optimistic,
      utilization_pct: optionB_util_pct,
      annual_labor_cost: Math.round(optionB_labor),
      annual_vehicle_cost: Math.round(optionB_vehicle),
      total_annual_cost: Math.round(totalB),
      branch_breakdown: optionB_branch_breakdown,
      utilization_breakdown: {
        per_branch: optionB_branch_breakdown,
        per_region: optionB_per_region,
        portfolio: optionB_portfolio,
      },
      overnight_summary: overnightSummary,
      pros: [
        'Simple — each crew owns one cluster',
        'Defensible to clients — predictable, named teams',
        'Lower coordination overhead',
      ],
      cons: [
        'Lower average utilization (paid for some idle time)',
        'Branches outside the band need surge crews or consolidation',
        'Harder to flex across branches when seasonal demand shifts',
      ],
      recommended_use_case:
        'Year 1 of a new portfolio. Best when geographic spread > 5 states.',
    },
    C: {
      label: 'Surge Model',
      crew_count: optionC_FT_crews,
      surge_crew_count: inputs.surge_crew_count,
      surge_weeks: inputs.surge_weeks_per_year,
      utilization_pct: optionC_util_pct,
      annual_labor_cost: Math.round(optionC_labor),
      annual_vehicle_cost: Math.round(optionC_vehicle),
      total_annual_cost: Math.round(totalC),
      utilization_breakdown: { portfolio: optionC_portfolio },
      overnight_summary: overnightSummary,
      pros: [
        'Lowest labor cost — FT crews highly utilized year-round',
        'Matches seasonal demand peaks (school breaks, etc.)',
        `Saves ~${Math.round(cVsBSavingsPct * 100)}% in labor vs Option B`,
      ],
      cons: [
        'Surge sourcing risk — must reliably staff up during peak weeks',
        'Training cost for surge crews',
        `Surge labor costs ${Math.round((inputs.surge_premium_multiplier - 1) * 100)}% more per hour`,
      ],
      recommended_use_case:
        'Strong regional surge labor market + predictable seasonal demand.',
    },
  }

  // ── Summary text ──────────────────────────────────────────────────────────
  const cheapestKey = (Object.entries(options) as [keyof typeof options, any][]).reduce(
    (a, b) => (a[1].total_annual_cost <= b[1].total_annual_cost ? a : b)
  )[0]

  const summaryParts: string[] = []
  summaryParts.push(
    `${properties.length} properties, ${Math.round(totalProjectHours).toLocaleString()} project-crew hours/year across ${branches.length} branch${branches.length === 1 ? '' : 'es'}.`
  )
  summaryParts.push(
    `Option A (Roving): ${optionA_crews} crews, ${optionA_util_pct}% util, $${Math.round(totalA / 1000).toLocaleString()}k. Option B (Dedicated): ${optionB_crews} crews, ${optionB_util_pct}% util, $${Math.round(totalB / 1000).toLocaleString()}k. Option C (Surge): ${optionC_FT_crews}+${inputs.surge_crew_count} crews, ${optionC_util_pct}% util, $${Math.round(totalC / 1000).toLocaleString()}k.`
  )
  summaryParts.push(
    `Cheapest on paper: Option ${cheapestKey}. Recommended: Option ${recommended} — ${recommendedRationale}`
  )
  if (propertiesMissingCoords > 0) {
    summaryParts.push(
      `${propertiesMissingCoords} properties without coordinates were assigned to the first branch.`
    )
  }

  return {
    outputs: {
      property_count: properties.length,
      k_used: kUsed,
      total_project_hours_per_year: Math.round(totalProjectHours),
      crew_count_analysis: crewCountAnalysis,
      branches: branches.map((b, i) => ({
        ...b,
        city_state: branchMeta[i].city_state,
        population: branchMeta[i].population,
        state: branchMeta[i].state_id,
        region: branchMeta[i].region,
      })),
      options,
      recommended_option: recommended,
      recommended_rationale: recommendedRationale,
      missing_coords_count: propertiesMissingCoords,
      utilization_constraint: band,
      constraint_violations,
    },
    summary_text: summaryParts.join(' '),
  }
}
