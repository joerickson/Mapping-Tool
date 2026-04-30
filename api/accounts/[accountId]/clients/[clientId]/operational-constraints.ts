// /api/accounts/[accountId]/operational-constraints
//   GET — returns the saved constraints merged with system defaults
//   PUT — upserts the saved row. Branches without lat/lng get geocoded
//         server-side using the existing google-address helper.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../../_lib/supabase.js'
import { authenticateRequest } from '../../../../_lib/auth.js'
import {
  loadConstraints,
  SYSTEM_DEFAULTS,
  type ExistingBranch,
} from '../../../../_lib/analysis/operational-constraints.js'
import { geocodeAddress } from '../../../../_lib/google-address.js'
import { triggerSynthesisRefresh } from '../../../../_lib/synthesis-refresh.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  let ctx: Awaited<ReturnType<typeof authenticateRequest>>
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const accountId = req.query.accountId as string
  const clientId = req.query.clientId as string
  const db = createAdminClient()

  if (req.method === 'GET') {
    const constraints = await loadConstraints(db, accountId, clientId)
    return res.status(200).json({
      ...constraints,
      system_defaults: SYSTEM_DEFAULTS,
    })
  }

  if (req.method === 'PUT') {
    const body = (req.body ?? {}) as any

    // Geocode any existing_branches missing lat/lng before saving.
    const branches: ExistingBranch[] = Array.isArray(body.existing_branches)
      ? body.existing_branches
      : []
    const geocodedBranches: ExistingBranch[] = []
    for (const b of branches) {
      if (
        Number.isFinite(b.lat) &&
        Number.isFinite(b.lng) &&
        b.lat !== 0 &&
        b.lng !== 0
      ) {
        geocodedBranches.push({
          name: String(b.name ?? '').trim() || 'Unnamed branch',
          address: b.address ?? null,
          lat: Number(b.lat),
          lng: Number(b.lng),
          locked: b.locked !== false, // default to locked
        })
        continue
      }
      // Geocode by free-form address. Parse "Street, City, ST ZIP" loosely;
      // fall back to passing the whole string as address_line1 if parsing fails.
      const raw = String(b.address ?? '').trim()
      if (!raw) {
        return res.status(400).json({
          error: `Branch "${b.name ?? '(unnamed)'}" needs either lat/lng or an address`,
        })
      }
      const parsed = parseFreeFormAddress(raw)
      try {
        const geo = await geocodeAddress(parsed)
        if (!geo) throw new Error('geocoder returned no results')
        geocodedBranches.push({
          name: String(b.name ?? '').trim() || 'Unnamed branch',
          address: geo.formatted_address || raw,
          lat: geo.latitude,
          lng: geo.longitude,
          locked: b.locked !== false,
        })
      } catch (err: any) {
        return res.status(400).json({
          error: `Could not geocode branch "${b.name ?? '(unnamed)'}": ${
            err?.message ?? 'unknown error'
          }`,
        })
      }
    }

    // Build the upsert payload. Numeric/int fields: pass through whatever was
    // sent; if the value is null/undefined we explicitly NULL the column so
    // the loader falls back to SYSTEM_DEFAULTS.
    const numericFields: Array<keyof typeof SYSTEM_DEFAULTS> = [
      'crew_size',
      'hours_per_day',
      'hourly_loaded_labor_cost',
      'project_clean_base_hours',
      'project_clean_hours_per_sqft',
      'upholstery_solo_hours',
      'upholstery_combo_hours_pct',
      'recurring_productivity_sqft_per_hour',
      'fuel_cost_per_mile',
      'vehicles_per_crew',
      'surge_weeks_per_year',
      'surge_crew_count',
      'surge_premium_multiplier',
      'branch_overhead_annual',
      'hotels_annual',
      'vehicle_lease_annual_per_crew',
      'supplies_pct_of_labor',
      'insurance_annual',
      'corporate_overhead_pct',
      'target_gross_margin_pct',
      'drive_speed_mph',
      'max_one_way_drive_minutes',
    ]

    const upsert: Record<string, unknown> = {
      account_id: accountId,
      client_id: clientId,
      existing_branches: geocodedBranches,
      excluded_property_ids: Array.isArray(body.excluded_property_ids)
        ? body.excluded_property_ids
        : [],
      excluded_property_reason: body.excluded_property_reason ?? null,
      updated_at: new Date().toISOString(),
      updated_by: ctx.userId ?? null,
    }
    // Population + utilization constraint blobs (full-replace if provided).
    if (body.population_constraint && typeof body.population_constraint === 'object') {
      upsert.population_constraint = body.population_constraint
    }
    if (body.utilization_constraint && typeof body.utilization_constraint === 'object') {
      upsert.utilization_constraint = body.utilization_constraint
    }
    // Phase 3.5 — additional cost-assumption columns.
    if ('working_days_per_year' in body) {
      upsert.working_days_per_year =
        body.working_days_per_year == null || body.working_days_per_year === ''
          ? null
          : Number(body.working_days_per_year)
    }
    if ('visits_per_year_default' in body) {
      upsert.visits_per_year_default =
        body.visits_per_year_default == null || body.visits_per_year_default === ''
          ? null
          : Number(body.visits_per_year_default)
    }
    if (body.labor_burden_breakdown && typeof body.labor_burden_breakdown === 'object') {
      upsert.labor_burden_breakdown = body.labor_burden_breakdown
    }
    // Phase 3.7 — overnight cost knobs + flat override.
    if (body.hotel_cost_config && typeof body.hotel_cost_config === 'object') {
      upsert.hotel_cost_config = body.hotel_cost_config
    }
    if ('hotels_annual_override' in body) {
      const raw = body.hotels_annual_override
      if (raw === null || raw === '' || raw === undefined) {
        upsert.hotels_annual_override = null
      } else {
        const n = typeof raw === 'string' ? parseFloat(raw) : raw
        upsert.hotels_annual_override = Number.isFinite(n) ? n : null
      }
    }
    // Phase 3.9 — structured costs.
    if (body.branch_overhead_config && typeof body.branch_overhead_config === 'object') {
      upsert.branch_overhead_config = body.branch_overhead_config
    }
    if (body.branch_overhead_overrides && typeof body.branch_overhead_overrides === 'object') {
      upsert.branch_overhead_overrides = body.branch_overhead_overrides
    }
    if ('branch_overhead_annual_override' in body) {
      const raw = body.branch_overhead_annual_override
      if (raw === null || raw === '' || raw === undefined) {
        upsert.branch_overhead_annual_override = null
      } else {
        const n = typeof raw === 'string' ? parseFloat(raw) : raw
        upsert.branch_overhead_annual_override = Number.isFinite(n) ? n : null
      }
    }
    if (body.insurance_config && typeof body.insurance_config === 'object') {
      upsert.insurance_config = body.insurance_config
    }
    if ('insurance_annual_override' in body) {
      const raw = body.insurance_annual_override
      if (raw === null || raw === '' || raw === undefined) {
        upsert.insurance_annual_override = null
      } else {
        const n = typeof raw === 'string' ? parseFloat(raw) : raw
        upsert.insurance_annual_override = Number.isFinite(n) ? n : null
      }
    }
    if (body.vehicle_config && typeof body.vehicle_config === 'object') {
      upsert.vehicle_config = body.vehicle_config
    }
    if ('vehicle_lease_annual_per_crew_override' in body) {
      const raw = body.vehicle_lease_annual_per_crew_override
      if (raw === null || raw === '' || raw === undefined) {
        upsert.vehicle_lease_annual_per_crew_override = null
      } else {
        const n = typeof raw === 'string' ? parseFloat(raw) : raw
        upsert.vehicle_lease_annual_per_crew_override = Number.isFinite(n) ? n : null
      }
    }
    for (const k of numericFields) {
      const raw = body[k]
      if (raw === undefined || raw === null || raw === '') {
        upsert[k] = null
      } else {
        const n = typeof raw === 'string' ? parseFloat(raw) : raw
        upsert[k] = Number.isFinite(n) ? n : null
      }
    }

    const { error } = await db
      .from('account_operational_constraints')
      .upsert(upsert, { onConflict: 'account_id,client_id' })

    if (error) {
      return res.status(500).json({ error: `Failed to save: ${error.message}` })
    }

    await triggerSynthesisRefresh(db, accountId, clientId)
    const merged = await loadConstraints(db, accountId, clientId)
    return res.status(200).json({ ...merged, system_defaults: SYSTEM_DEFAULTS })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

// Best-effort split of a free-form US address into the AddressInput shape.
// Acceptable forms include:
//   "1234 Main St, Frisco, TX 75034"
//   "Frisco, TX"
//   "1234 Main St Frisco TX 75034"
function parseFreeFormAddress(input: string): {
  address_line1: string
  address_line2?: string | null
  city: string
  state: string
  postal_code: string
  country: string
} {
  const parts = input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (parts.length >= 3) {
    // [street, city, state-zip]
    const stateZip = parts[parts.length - 1]
    const m = /^([A-Za-z]{2})\s*(\d{5})?/.exec(stateZip)
    return {
      address_line1: parts.slice(0, parts.length - 2).join(', '),
      city: parts[parts.length - 2],
      state: (m?.[1] ?? '').toUpperCase(),
      postal_code: m?.[2] ?? '',
      country: 'US',
    }
  }
  if (parts.length === 2) {
    // [city, state(-zip)]
    const m = /^([A-Za-z]{2})\s*(\d{5})?/.exec(parts[1])
    return {
      address_line1: '',
      city: parts[0],
      state: (m?.[1] ?? '').toUpperCase(),
      postal_code: m?.[2] ?? '',
      country: 'US',
    }
  }
  // Single token — let the geocoder do the work.
  return {
    address_line1: input,
    city: '',
    state: '',
    postal_code: '',
    country: 'US',
  }
}
