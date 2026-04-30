// POST /api/analyses/[accountId]/seasonality-capacity
// Identifies peak demand windows (school breaks) and calculates surge crew
// requirements vs the year-round baseline.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../../../_lib/supabase.js'
import { authenticateRequest } from '../../../../../_lib/auth.js'
import {
  loadAccountProperties,
  createAnalysisRecord,
  completeAnalysisRecord,
  failAnalysisRecord,
  fetchLatestCompletedAnalysis,
  type AccountProperty,
} from '../../../../../_lib/analysis/account-data.js'
import {
  loadAccountOfferings,
  classifyOffering,
  isSchoolWindowOffering,
} from '../../../../../_lib/analysis/service-offerings.js'
import {
  loadConstraints,
  applyExclusions,
  requireSelectedBranches,
  NO_SELECTION_ERROR,
} from '../../../../../_lib/analysis/operational-constraints.js'
import { resolveCrews } from '../../../../../_lib/analysis/crew-resolution.js'

export const config = { maxDuration: 60 }

interface WindowSpec {
  start_month: number
  start_day: number
  end_month: number
  end_day: number
}

export interface SeasonalityInputs {
  client_id?: string | null
  windows: {
    summer_break: WindowSpec
    winter_break: WindowSpec
    spring_break: WindowSpec
  }
  // Crew shape (defaults match crew_strategy)
  crew_size: number
  hours_per_day: number
  // Productivity for project clean (S&I uses same formula in Crew Strategy)
  project_clean_base_hours: number
  project_clean_hours_per_sqft: number
  visits_per_year_default: number
}

const DEFAULT_WINDOWS: SeasonalityInputs['windows'] = {
  summer_break: { start_month: 6, start_day: 1, end_month: 8, end_day: 15 },
  winter_break: { start_month: 12, start_day: 18, end_month: 1, end_day: 6 },
  spring_break: { start_month: 3, start_day: 15, end_month: 3, end_day: 25 },
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function windowDurationDays(w: WindowSpec): number {
  // Approximate, accounting for year-wrapping (winter break crosses years)
  const startDay = dayOfYear(w.start_month, w.start_day)
  const endDay = dayOfYear(w.end_month, w.end_day)
  if (endDay >= startDay) return endDay - startDay + 1
  return 365 - startDay + endDay + 1
}

function dayOfYear(month: number, day: number): number {
  // Non-leap-year reference
  const cumDays = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
  return cumDays[month - 1] + day
}

function formatWindow(w: WindowSpec): { start: string; end: string } {
  return {
    start: `${MONTH_NAMES[w.start_month - 1]} ${w.start_day}`,
    end: `${MONTH_NAMES[w.end_month - 1]} ${w.end_day}`,
  }
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
  const body = (req.body ?? {}) as Partial<SeasonalityInputs>
  const db = createAdminClient()
  const constraints = await loadConstraints(db, accountId, clientId)

  // Tier 2: requires the user to have confirmed a branch selection.
  const sel = requireSelectedBranches(constraints)
  if (!sel.ok) return res.status(400).json(NO_SELECTION_ERROR)

  const inputs: SeasonalityInputs = {
    client_id: body.client_id ?? constraints.client_id ?? null,
    windows: body.windows ?? DEFAULT_WINDOWS,
    crew_size: body.crew_size ?? constraints.crew_size,
    hours_per_day: body.hours_per_day ?? constraints.hours_per_day,
    project_clean_base_hours:
      body.project_clean_base_hours ?? constraints.project_clean_base_hours,
    project_clean_hours_per_sqft:
      body.project_clean_hours_per_sqft ?? constraints.project_clean_hours_per_sqft,
    visits_per_year_default: body.visits_per_year_default ?? 2,
  }

  let analysisId: string
  try {
    analysisId = await createAnalysisRecord(db, {
      account_id: accountId,
      client_id: clientId,
      module_key: 'seasonality_capacity',
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
    const crewStrategy = await fetchLatestCompletedAnalysis(db, accountId, clientId, 'crew_strategy')
    const result = computeSeasonality(properties, offerings, crewStrategy?.outputs, inputs, constraints)

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

export function computeSeasonality(
  properties: AccountProperty[],
  offerings: Map<string, { id: string; name: string }>,
  crewStrategyOutputs: any,
  inputs: SeasonalityInputs,
  constraints?: {
    crew_strategy_selected_option?: 'A' | 'B' | 'C' | null
    crew_count_per_branch_override?: Record<string, number> | null
  }
) {
  // ── Per-service-location: hours per visit + window classification ─────────
  type SLEntry = {
    property_id: string
    offering_name: string
    hours_per_visit: number
    visits_per_year: number
    window: 'summer_break' | 'winter_break' | 'spring_break' | 'year_round'
  }
  const entries: SLEntry[] = []

  for (const p of properties) {
    for (const sl of p.service_locations) {
      const offering = sl.service_offering_id ? offerings.get(sl.service_offering_id) : null
      if (!offering) continue
      const cls = classifyOffering(offering.name)
      const sqft = sl.serviceable_sqft ?? 0
      const visits = sl.visits_per_year_override ?? inputs.visits_per_year_default

      let hpv = 0
      if (cls === 'project_clean') {
        hpv = inputs.project_clean_base_hours + sqft * inputs.project_clean_hours_per_sqft
      } else if (cls === 'upholstery') {
        hpv = 2
      } else if (cls === 'recurring_janitorial') {
        hpv = sqft / 3000 // standard productivity
      } else {
        continue // 'other' — skip
      }
      hpv = Math.max(hpv, 1)

      // Bucket: school-window offerings cluster in summer; assume project
      // clean is summer-leaning unless explicitly recurring; the rest is
      // year-round. Real data would have explicit scheduling — this is a v1
      // heuristic.
      let window: SLEntry['window'] = 'year_round'
      if (isSchoolWindowOffering(offering.name)) {
        window = 'summer_break' // S&I is the canonical summer-break work
      } else if (cls === 'project_clean') {
        // Project clean for non-school properties is typically split across
        // the year — but in school portfolios still falls in break windows.
        // Default: split summer-heavy.
        window = 'summer_break'
      }

      entries.push({
        property_id: p.id,
        offering_name: offering.name,
        hours_per_visit: hpv,
        visits_per_year: visits,
        window,
      })
    }
  }

  // ── Per-window demand ─────────────────────────────────────────────────────
  const windowKeys: Array<keyof SeasonalityInputs['windows']> = [
    'summer_break',
    'spring_break',
    'winter_break',
  ]

  // Derive baseline crew capacity from latest Crew Strategy if available.
  // Phase 4.2 — honor user's selected option + manual per-branch override.
  let baselineCrews = 4
  if (crewStrategyOutputs?.options) {
    const resolved = resolveCrews(crewStrategyOutputs, constraints ?? {})
    baselineCrews = resolved.crew_count || 4
  }

  const windowResults = windowKeys.map((key) => {
    const w = inputs.windows[key]
    const duration = windowDurationDays(w)
    const formatted = formatWindow(w)
    const slMatching = entries.filter((e) => e.window === key)

    // Each window-bound service_location is serviced once during the window
    const slCount = slMatching.length
    const totalHours = slMatching.reduce((sum, e) => sum + e.hours_per_visit, 0)
    const crewDays = totalHours / (inputs.crew_size * inputs.hours_per_day)
    // ~70% of days in the window are workdays (5 of 7)
    const workableDays = Math.max(1, Math.floor(duration * (5 / 7)))
    const simultaneousCrews = Math.ceil(crewDays / workableDays)
    const surgeNeeded = simultaneousCrews > baselineCrews
    const surgeCrews = surgeNeeded ? simultaneousCrews - baselineCrews : 0

    return {
      window_name: key,
      start_date: formatted.start,
      end_date: formatted.end,
      duration_days: duration,
      demand: {
        service_location_count: slCount,
        total_hours_required: Math.round(totalHours),
        crew_days_required: Math.round(crewDays * 10) / 10,
        simultaneous_crews_needed: simultaneousCrews,
      },
      baseline_capacity: {
        crew_count: baselineCrews,
        crew_days_available: baselineCrews * workableDays,
      },
      surge_required: surgeNeeded,
      surge_crews_needed: surgeCrews,
      notes: surgeNeeded
        ? `Demand exceeds baseline by ${surgeCrews} crew${surgeCrews === 1 ? '' : 's'} during this ${duration}-day window. Plan surge sourcing.`
        : `Baseline capacity covers this window with ${baselineCrews - simultaneousCrews} crew${baselineCrews - simultaneousCrews === 1 ? '' : 's'} of slack.`,
    }
  })

  // ── Year-round baseline (recurring services) ──────────────────────────────
  const yearRoundEntries = entries.filter((e) => e.window === 'year_round')
  const yearRoundLocationCount = new Set(yearRoundEntries.map((e) => e.property_id)).size
  const yearRoundAnnualHours = yearRoundEntries.reduce(
    (sum, e) => sum + e.hours_per_visit * e.visits_per_year,
    0
  )
  const avgWeeklyHours = yearRoundAnnualHours / 52
  const crewsRequiredBaseline =
    avgWeeklyHours / (5 * inputs.hours_per_day * inputs.crew_size)

  // Peak-to-baseline ratio
  const peakSimultaneous = Math.max(
    ...windowResults.map((w) => w.demand.simultaneous_crews_needed),
    0
  )
  const peakRatio = crewsRequiredBaseline > 0 ? peakSimultaneous / crewsRequiredBaseline : 0

  // ── Summary text ──────────────────────────────────────────────────────────
  const peakWindow = windowResults
    .slice()
    .sort(
      (a, b) =>
        b.demand.simultaneous_crews_needed - a.demand.simultaneous_crews_needed
    )[0]
  const summaryParts: string[] = []
  if (peakWindow) {
    summaryParts.push(
      `Demand peaks during ${peakWindow.window_name.replace('_', ' ')} (${peakWindow.start_date}–${peakWindow.end_date}) requiring ${peakWindow.demand.simultaneous_crews_needed} simultaneous crews vs baseline of ${baselineCrews}.`
    )
  }
  const surgeWindows = windowResults.filter((w) => w.surge_required)
  if (surgeWindows.length > 0) {
    summaryParts.push(
      `Plan surge sourcing for ${surgeWindows.map((w) => w.window_name.replace('_', ' ')).join(', ')}.`
    )
  } else {
    summaryParts.push('Baseline crew count covers all defined peak windows.')
  }
  if (peakRatio > 0) {
    summaryParts.push(
      `Peak-to-baseline ratio: ${peakRatio.toFixed(1)}x (${Math.round(crewsRequiredBaseline * 10) / 10} avg-week crews vs ${peakSimultaneous} peak-week crews).`
    )
  }

  return {
    outputs: {
      property_count: properties.length,
      windows: windowResults,
      year_round_baseline: {
        service_location_count: yearRoundEntries.length,
        property_count: yearRoundLocationCount,
        avg_weekly_hours: Math.round(avgWeeklyHours),
        crews_required: Math.round(crewsRequiredBaseline * 10) / 10,
      },
      peak_to_baseline_ratio: Math.round(peakRatio * 10) / 10,
      baseline_crew_count_used: baselineCrews,
    },
    summary_text: summaryParts.join(' '),
  }
}
