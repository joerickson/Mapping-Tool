// POST /api/analyses/account/[accountId]/scenario-compute
// Runs the scenario orchestrator with the supplied overrides and returns a
// side-by-side compare object (baseline vs scenario) without writing
// anything to portfolio_analyses or analysis_scenarios. The dashboard's
// scenario panel and chat's simulate_scenario tool both call this.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import { loadConstraints } from '../../../_lib/analysis/operational-constraints.js'
import {
  runAllModules,
  summarizeForCompare,
  type ScenarioOverrides,
} from '../../../_lib/analysis/run-all-modules.js'
import { loadLatestModuleSnapshots } from '../../../_lib/analysis/load-all-modules.js'

export const config = { maxDuration: 60 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const accountId = req.query.accountId as string
  const body = (req.body ?? {}) as {
    overrides?: ScenarioOverrides
    modules_to_run?: string[]
  }
  const db = createAdminClient()

  try {
    const baselineConstraints = await loadConstraints(db, accountId)
    if (!baselineConstraints.selected_branches?.length) {
      return res.status(400).json({
        error: 'No branches selected. Run Branch Optimization and confirm a selection first.',
        code: 'BRANCHES_NOT_SELECTED',
      })
    }

    // Baseline = use existing module results from portfolio_analyses (don't
    // recompute — they're the user's source of truth). Scenario = run with
    // overrides applied.
    const baselineSnapshots = await loadLatestModuleSnapshots(db, accountId)
    const baselineSummary = {
      bid_total: baselineSnapshots.bid_pricing_structure?.outputs?.bid_total ?? null,
      bid_per_property:
        baselineSnapshots.bid_pricing_structure?.outputs?.bid_per_property ?? null,
      monthly_invoice_estimate:
        baselineSnapshots.bid_pricing_structure?.outputs?.monthly_invoice_estimate ?? null,
      margin_pct:
        baselineSnapshots.bid_pricing_structure?.outputs?.margin?.target_pct ?? null,
      crew_recommended_option:
        baselineSnapshots.crew_strategy?.outputs?.recommended_option ?? null,
      crew_total_annual_cost:
        baselineSnapshots.crew_strategy?.outputs?.options?.[
          baselineSnapshots.crew_strategy?.outputs?.recommended_option
        ]?.total_annual_cost ?? null,
      branch_count_recommended:
        baselineSnapshots.branch_optimization?.outputs?.recommended_k ?? null,
    }

    const scenarioResults = await runAllModules(db, accountId, {
      baselineConstraints,
      overrides: body.overrides ?? {},
      modulesToRun: body.modules_to_run as any,
    })
    const scenarioSummary = summarizeForCompare(scenarioResults)

    // Deltas — only on numeric metrics for a quick UI pass
    const deltas: Record<string, { baseline: number | null; scenario: number | null; pct: number | null }> = {}
    for (const k of [
      'bid_total',
      'bid_per_property',
      'monthly_invoice_estimate',
      'crew_total_annual_cost',
    ] as const) {
      const b = (baselineSummary as any)[k]
      const s = (scenarioSummary as any)[k]
      const pct =
        typeof b === 'number' && typeof s === 'number' && b !== 0
          ? Math.round(((s - b) / b) * 1000) / 10
          : null
      deltas[k] = { baseline: b ?? null, scenario: s ?? null, pct }
    }

    return res.status(200).json({
      baseline: { summary: baselineSummary },
      scenario: { module_results: scenarioResults, summary: scenarioSummary },
      deltas,
      effective_overrides: body.overrides ?? {},
    })
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? String(err) })
  }
}
