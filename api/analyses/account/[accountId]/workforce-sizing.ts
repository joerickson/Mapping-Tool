// POST /api/analyses/[accountId]/workforce-sizing
// Sizes the recurring janitorial / housekeeping workforce (Workforce B).
// Workforce A (project crews) is covered by the Crew Strategy module — this
// module just references it.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import {
  loadAccountProperties,
  createAnalysisRecord,
  completeAnalysisRecord,
  failAnalysisRecord,
  fetchLatestCompletedAnalysis,
} from '../../../_lib/analysis/account-data.js'
import {
  loadAccountOfferings,
  isWorkforceBOffering,
} from '../../../_lib/analysis/service-offerings.js'
import {
  loadConstraints,
  applyExclusions,
} from '../../../_lib/analysis/operational-constraints.js'

export const config = { maxDuration: 60 }

interface WorkforceInputs {
  client_id?: string | null
  productivity_sqft_per_hour: number
  fte_hours_per_year: number
  part_time_avg_hours_per_week: number
  workforce_b_offerings: string[] | null // optional override; offering NAMES
  recurring_visits_per_year_default: number // weekly = 52
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
  const body = (req.body ?? {}) as Partial<WorkforceInputs>
  const db = createAdminClient()
  const constraints = await loadConstraints(db, accountId)
  const inputs: WorkforceInputs = {
    client_id: body.client_id ?? constraints.client_id ?? null,
    productivity_sqft_per_hour:
      body.productivity_sqft_per_hour ?? constraints.recurring_productivity_sqft_per_hour,
    fte_hours_per_year: body.fte_hours_per_year ?? 1880,
    part_time_avg_hours_per_week: body.part_time_avg_hours_per_week ?? 25,
    workforce_b_offerings: body.workforce_b_offerings ?? null,
    recurring_visits_per_year_default: body.recurring_visits_per_year_default ?? 52,
  }

  let analysisId: string
  try {
    analysisId = await createAnalysisRecord(db, {
      account_id: accountId,
      client_id: inputs.client_id ?? null,
      module_key: 'workforce_sizing',
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
    const crewStrategy = await fetchLatestCompletedAnalysis(db, accountId, 'crew_strategy')

    // Determine which offering ids fall under Workforce B
    const wbOfferingIds = new Set<string>()
    const wbOfferingByName = new Map<string, string>()
    const overrideNameSet = inputs.workforce_b_offerings
      ? new Set(inputs.workforce_b_offerings.map((s) => s.toLowerCase()))
      : null

    for (const o of offerings.values()) {
      const matches = overrideNameSet
        ? overrideNameSet.has(o.name.toLowerCase())
        : isWorkforceBOffering(o.name)
      if (matches) {
        wbOfferingIds.add(o.id)
        wbOfferingByName.set(o.id, o.name)
      }
    }

    // Aggregate Workforce B hours across all matching service_locations
    const byOffering = new Map<string, { name: string; hours: number; locations: number }>()
    let totalHours = 0
    let propertiesServed = new Set<string>()
    let workforceBLocationCount = 0

    for (const p of properties) {
      for (const sl of p.service_locations) {
        if (!sl.service_offering_id || !wbOfferingIds.has(sl.service_offering_id)) continue
        const offering = offerings.get(sl.service_offering_id)
        if (!offering) continue

        const sqft = sl.serviceable_sqft ?? 0
        const hoursPerVisit =
          inputs.productivity_sqft_per_hour > 0 ? sqft / inputs.productivity_sqft_per_hour : 0
        const visits = sl.visits_per_year_override ?? inputs.recurring_visits_per_year_default
        const annualHours = hoursPerVisit * visits

        totalHours += annualHours
        propertiesServed.add(p.id)
        workforceBLocationCount += 1

        const cur = byOffering.get(offering.id) ?? { name: offering.name, hours: 0, locations: 0 }
        cur.hours += annualHours
        cur.locations += 1
        byOffering.set(offering.id, cur)
      }
    }

    const fteCount = inputs.fte_hours_per_year > 0 ? totalHours / inputs.fte_hours_per_year : 0
    const partTimeWeeklyHours = inputs.part_time_avg_hours_per_week
    const partTimePositionsEstimate =
      partTimeWeeklyHours > 0 ? totalHours / (partTimeWeeklyHours * 52) : 0

    // Workforce A reference — pull crew_count from latest crew_strategy
    let workforceAFteEquivalent = 0
    let workforceANote =
      'Run Crew Strategy first to size the project crew workforce.'
    if (crewStrategy?.outputs) {
      const recommendedKey = crewStrategy.outputs.recommended_option as 'A' | 'B' | 'C'
      const opt = crewStrategy.outputs.options?.[recommendedKey]
      if (opt) {
        const crewCount =
          (opt.crew_count ?? 0) + (recommendedKey === 'C' ? opt.surge_crew_count ?? 0 : 0)
        const crewSize = (crewStrategy.outputs as any).inputs?.crew_size ?? 3
        // FTE equivalent of the project crew workforce
        workforceAFteEquivalent = crewCount * crewSize
        workforceANote = `Per Crew Strategy (Option ${recommendedKey}): ${crewCount} crew${crewCount === 1 ? '' : 's'} × ~${crewSize} workers ≈ ${workforceAFteEquivalent} FTE equivalent.`
      }
    }

    const totalFte = workforceAFteEquivalent + fteCount

    const summaryParts: string[] = []
    summaryParts.push(
      `Workforce B (recurring janitorial): ${Math.round(totalHours).toLocaleString()} hrs/year across ${propertiesServed.size} properties = ${fteCount.toFixed(1)} FTE.`
    )
    summaryParts.push(
      `Estimated ${Math.round(partTimePositionsEstimate)} part-time positions at ${partTimeWeeklyHours} hrs/week.`
    )
    summaryParts.push(workforceANote)
    summaryParts.push(
      `Total workforce: ~${totalFte.toFixed(1)} FTE equivalent across both workforces.`
    )

    const result = {
      outputs: {
        property_count: properties.length,
        workforce_a: {
          label: 'Project Crew Workforce',
          description:
            'Roving / dedicated project clean and upholstery crews — see Crew Strategy module',
          sourced_from: 'crew_strategy',
          fte_equivalent: workforceAFteEquivalent,
          note: workforceANote,
        },
        workforce_b: {
          label: 'Recurring Janitorial / Housekeeping',
          total_annual_hours: Math.round(totalHours),
          fte_count: +fteCount.toFixed(2),
          part_time_position_count_estimate: Math.round(partTimePositionsEstimate),
          properties_served: propertiesServed.size,
          service_location_count: workforceBLocationCount,
          by_offering: Array.from(byOffering.values())
            .map((v) => ({
              offering_name: v.name,
              location_count: v.locations,
              total_hours: Math.round(v.hours),
              fte_equivalent: +(v.hours / inputs.fte_hours_per_year).toFixed(2),
            }))
            .sort((a, b) => b.total_hours - a.total_hours),
        },
        total_workforce_size: {
          fte_equivalent: +totalFte.toFixed(1),
          distinct_positions_estimate:
            Math.round(workforceAFteEquivalent) + Math.round(partTimePositionsEstimate),
        },
      },
      summary_text: summaryParts.join(' '),
    }

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
