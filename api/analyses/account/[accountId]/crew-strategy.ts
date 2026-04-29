// POST /api/analyses/[accountId]/crew-strategy
// Compares three crew structuring options and returns full economics for each.
//   A: Roving — variable-cost, paid for actual work hours
//   B: Dedicated — N+1 crews paid full-time, lower utilization
//   C: Surge — 3 FT + 3 surge crews for half the year
// Reference: JLL Red River Excel methodology.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import {
  loadAccountProperties,
  createAnalysisRecord,
  completeAnalysisRecord,
  failAnalysisRecord,
  type AccountProperty,
} from '../../../_lib/analysis/account-data.js'
import {
  loadAccountOfferings,
  classifyOffering,
} from '../../../_lib/analysis/service-offerings.js'
import { haversineMiles, type LatLng } from '../../../_lib/analysis/haversine.js'
import {
  loadConstraints,
  applyExclusions,
  requireSelectedBranches,
  NO_SELECTION_ERROR,
} from '../../../_lib/analysis/operational-constraints.js'

export const config = { maxDuration: 60 }

export interface CrewStrategyInputs {
  client_id?: string | null
  k: number | null
  branches: Array<{ name: string; lat: number; lng: number; property_count?: number }> | null
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
}

const FTE_HOURS_PER_YEAR = 1880 // 47 weeks × 40 hours
const ROVING_ESTIMATED_ANNUAL_MILES_PER_CREW = 30000

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
  const body = (req.body ?? {}) as Partial<CrewStrategyInputs>

  const db = createAdminClient()
  const constraints = await loadConstraints(db, accountId)

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
  }

  let analysisId: string
  try {
    analysisId = await createAnalysisRecord(db, {
      account_id: accountId,
      client_id: inputs.client_id ?? null,
      module_key: 'crew_strategy',
      inputs: inputs as unknown as Record<string, unknown>,
      created_by: ctx.userId ?? null,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message ?? 'Failed to create analysis record' })
  }

  try {
    const allProperties = await loadAccountProperties(
      db,
      accountId,
      inputs.client_id ?? null
    )
    const properties = applyExclusions(allProperties, constraints.excluded_property_ids)
    const offerings = await loadAccountOfferings(db, accountId)

    // Tier 2 always uses the user's confirmed selection. Body.branches is
    // ignored — selection takes precedence per Phase 2.5b spec.
    const branches = sel.branches.map((b) => ({
      name: b.name,
      lat: b.lat,
      lng: b.lng,
    }))
    const kUsed = constraints.selected_k ?? branches.length

    const result = computeCrewStrategy(properties, offerings, branches, kUsed, inputs)

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
  inputs: CrewStrategyInputs
) {
  // ── Per-property work hours per year ──────────────────────────────────────
  // For each property we want total annual project-crew hours. A property may
  // have multiple service_locations (e.g. project clean + upholstery for the
  // same building). The upholstery_combo rule applies when both exist.

  type PropertyHours = {
    property: AccountProperty
    annual_hours: number
    branch_idx: number // index into branches[]
  }

  const perProperty: PropertyHours[] = []
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
      hoursPerVisit = Math.max(hoursPerVisit, 1)

      propAnnualHours += hoursPerVisit * visits
    }

    // Find nearest branch (re-cluster against the chosen branch set so we can
    // attribute work hours to a specific branch — needed for Option B util).
    let bestIdx = 0
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
    } else {
      propertiesMissingCoords += 1
    }

    perProperty.push({ property: p, annual_hours: propAnnualHours, branch_idx: bestIdx })
    totalAnnualHours += propAnnualHours
    totalProjectHours += propAnnualHours
  }

  // ── Per-branch aggregation (for Option B) ─────────────────────────────────
  const branchHours = new Array(branches.length).fill(0)
  const branchPropCount = new Array(branches.length).fill(0)
  for (const ph of perProperty) {
    branchHours[ph.branch_idx] += ph.annual_hours
    branchPropCount[ph.branch_idx] += 1
  }

  // ── Option A: Roving ──────────────────────────────────────────────────────
  // Variable cost — paid only for hours worked. Right-size crew count so that
  // crews × FTE-hours ≈ work-hours / target-utilization.
  const optionA_crews = Math.max(1, Math.ceil(totalAnnualHours / (FTE_HOURS_PER_YEAR * 0.89)))
  const optionA_labor =
    totalAnnualHours * inputs.hourly_loaded_labor_cost * inputs.crew_size
  const optionA_util_pct =
    optionA_crews > 0
      ? Math.min(
          100,
          Math.round((totalAnnualHours / (optionA_crews * FTE_HOURS_PER_YEAR)) * 100)
        )
      : 0
  const optionA_vehicle =
    optionA_crews *
    inputs.vehicles_per_crew *
    ROVING_ESTIMATED_ANNUAL_MILES_PER_CREW *
    inputs.fuel_cost_per_mile

  // ── Option B: Dedicated (N+1, largest branch gets the +1) ────────────────
  const branchOrderByHours = branches
    .map((_, i) => i)
    .sort((a, b) => branchHours[b] - branchHours[a])
  const crewsPerBranch = new Array(branches.length).fill(1)
  if (branches.length >= 1) crewsPerBranch[branchOrderByHours[0]] = 2
  const optionB_crews = crewsPerBranch.reduce((a: number, b: number) => a + b, 0)

  const optionB_labor =
    optionB_crews * FTE_HOURS_PER_YEAR * inputs.hourly_loaded_labor_cost * inputs.crew_size
  // Per-branch utilization = work_hours_in_branch / (crews_in_branch * FTE_hours)
  let optionB_util_sum = 0
  let optionB_util_count = 0
  const optionB_branch_breakdown: Array<{
    branch: string
    crew_count: number
    work_hours: number
    utilization_pct: number
    property_count: number
  }> = []
  for (let i = 0; i < branches.length; i++) {
    const crews = crewsPerBranch[i]
    const util = crews > 0 ? branchHours[i] / (crews * FTE_HOURS_PER_YEAR) : 0
    const utilPct = Math.round(util * 100)
    optionB_util_sum += utilPct
    optionB_util_count += 1
    optionB_branch_breakdown.push({
      branch: branches[i].name,
      crew_count: crews,
      work_hours: Math.round(branchHours[i]),
      utilization_pct: utilPct,
      property_count: branchPropCount[i],
    })
  }
  const optionB_util_pct = optionB_util_count > 0 ? Math.round(optionB_util_sum / optionB_util_count) : 0
  const optionB_vehicle =
    optionB_crews *
    inputs.vehicles_per_crew *
    ROVING_ESTIMATED_ANNUAL_MILES_PER_CREW *
    0.7 * // dedicated crews drive less than roving
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
  // FT crews are highly utilized year-round; surge crews are utilized only
  // when active. A blended utilization estimate.
  const optionC_FT_capacity = optionC_FT_crews * FTE_HOURS_PER_YEAR
  const optionC_FT_util = Math.min(
    1,
    totalAnnualHours / (optionC_FT_capacity + inputs.surge_crew_count * inputs.surge_weeks_per_year * hoursPerWeek)
  )
  const optionC_util_pct = Math.round(Math.min(0.99, optionC_FT_util * 1.07) * 100) // FT highly utilized
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
  if (properties.length > 400 && distinctStates > 5) {
    recommended = 'B'
    recommendedRationale = `${properties.length} properties across ${distinctStates} states — Option B (Dedicated) is the most defensible choice for Year 1. Predictable operations, simple to staff, and easier to bid against. Consider Option A in Year 2-3 once dispatch is dialed in.`
  } else if (cVsBSavingsPct > 0.15) {
    recommended = 'C'
    recommendedRationale = `Option C saves ${Math.round(
      cVsBSavingsPct * 100
    )}% in labor vs Option B. Strong candidate IF surge sourcing is reliable in this region — verify with regional ops before committing.`
  } else {
    recommended = 'B'
    recommendedRationale = `Option B (Dedicated) is the recommended baseline. Option C savings are below the 15% threshold needed to justify surge sourcing risk.`
  }

  // ── Output assembly ───────────────────────────────────────────────────────
  const options = {
    A: {
      label: 'Roving Crews',
      crew_count: optionA_crews,
      utilization_pct: optionA_util_pct,
      annual_labor_cost: Math.round(optionA_labor),
      annual_vehicle_cost: Math.round(optionA_vehicle),
      total_annual_cost: Math.round(totalA),
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
      utilization_pct: optionB_util_pct,
      annual_labor_cost: Math.round(optionB_labor),
      annual_vehicle_cost: Math.round(optionB_vehicle),
      total_annual_cost: Math.round(totalB),
      branch_breakdown: optionB_branch_breakdown,
      pros: [
        'Simple — each crew owns one cluster',
        'Defensible to clients — predictable, named teams',
        'Lower coordination overhead',
      ],
      cons: [
        'Lower average utilization (paid for some idle time)',
        'Largest branch needs +1 crew to absorb peak demand',
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
      branches,
      options,
      recommended_option: recommended,
      recommended_rationale: recommendedRationale,
      missing_coords_count: propertiesMissingCoords,
    },
    summary_text: summaryParts.join(' '),
  }
}
