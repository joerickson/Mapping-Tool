// GET  /api/analyses/account/[accountId]/clients/[clientId]/overnight-breakdown
// POST same path with { branches?, hotel_cost_config? } overrides for what-if
//
// Returns the full OvernightResult plus the resolved hotels value.
// Used by the Cost Assumptions panel preview + breakdown drawer.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../../../_lib/supabase.js'
import { authenticateRequest } from '../../../../../_lib/auth.js'
import { loadAccountProperties } from '../../../../../_lib/analysis/account-data.js'
import { loadAccountOfferings } from '../../../../../_lib/analysis/service-offerings.js'
import { computePropertyVisitHours } from '../../../../../_lib/analysis/property-hours.js'
import {
  loadConstraints,
  applyExclusions,
  requireSelectedBranches,
  HOTEL_COST_CONFIG_DEFAULTS,
  type HotelCostConfig,
} from '../../../../../_lib/analysis/operational-constraints.js'
import {
  calculateOvernights,
  resolveHotelsCost,
  type OvernightConfig,
  type OvernightBranch,
} from '../../../../../_lib/analysis/overnight-calculator.js'

export const config = { maxDuration: 30 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const accountId = req.query.accountId as string
  const clientId = req.query.clientId as string
  if (!accountId || !clientId) {
    return res.status(400).json({ error: 'accountId and clientId required' })
  }

  const db = createAdminClient()
  const constraints = await loadConstraints(db, accountId, clientId)

  // POST body can override branches + config for what-if.
  const body = (req.body ?? {}) as {
    branches?: OvernightBranch[]
    hotel_cost_config?: Partial<HotelCostConfig>
  }

  // Resolve branches: body override > saved selection > error.
  let branches: OvernightBranch[]
  if (Array.isArray(body.branches) && body.branches.length > 0) {
    branches = body.branches
  } else {
    const sel = requireSelectedBranches(constraints)
    if (!sel.ok) {
      return res.status(400).json({
        error: 'No branches selected. Select branches first to calculate overnight costs.',
        code: 'BRANCHES_NOT_SELECTED',
      })
    }
    branches = sel.branches.map((b) => ({ name: b.name, lat: b.lat, lng: b.lng }))
  }

  const mergedConfig: HotelCostConfig = {
    ...HOTEL_COST_CONFIG_DEFAULTS,
    ...constraints.hotel_cost_config,
    ...(body.hotel_cost_config ?? {}),
  }

  const overnightConfig: OvernightConfig = {
    drive_speed_mph: constraints.drive_speed_mph,
    overnight_trigger_one_way_hours: mergedConfig.overnight_trigger_one_way_hours,
    max_work_hours_per_crew_day: mergedConfig.max_work_hours_per_crew_day,
    buffer_hours_per_day: mergedConfig.buffer_hours_per_day,
    crew_size: constraints.crew_size,
    cost_per_night: mergedConfig.cost_per_night,
    per_diem_per_night: mergedConfig.per_diem_per_night,
    include_per_diem: mergedConfig.include_per_diem,
  }

  const allProperties = await loadAccountProperties(db, accountId, clientId)
  const properties = applyExclusions(allProperties, constraints.excluded_property_ids)
  const offerings = await loadAccountOfferings(db, accountId, clientId)

  const visits = computePropertyVisitHours(properties, offerings, {
    project_clean_base_hours: constraints.project_clean_base_hours,
    project_clean_hours_per_sqft: constraints.project_clean_hours_per_sqft,
    upholstery_solo_hours: constraints.upholstery_solo_hours,
    upholstery_combo_hours_pct: constraints.upholstery_combo_hours_pct,
    visits_per_year_default: constraints.visits_per_year_default ?? 2,
  })

  const calc = calculateOvernights(
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

  const resolved = resolveHotelsCost(
    calc,
    constraints.hotels_annual_override,
    constraints.hotels_annual,
    overnightConfig
  )

  return res.status(200).json({
    result: calc,
    resolved,
    config: mergedConfig,
    override: constraints.hotels_annual_override,
  })
}
