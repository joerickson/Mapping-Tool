// POST /api/analyses/account/[accountId]/synthesize
// Combines the latest completed run of every analysis module into a unified
// executive summary + full structured report. Persists as a row in
// portfolio_analyses with module_key='synthesis'.
//
// Claude (claude-sonnet-4-5) does the structured-text writing; we feed it the
// module outputs and constraints verbatim so it can cite real numbers rather
// than invent them.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '../../../../../_lib/supabase.js'
import { authenticateRequest } from '../../../../../_lib/auth.js'
import {
  createAnalysisRecord,
  completeAnalysisRecord,
  failAnalysisRecord,
  loadAccountProperties,
} from '../../../../../_lib/analysis/account-data.js'
import {
  loadLatestModuleSnapshots,
  ALL_MODULE_KEYS,
  type ModuleSnapshots,
} from '../../../../../_lib/analysis/load-all-modules.js'
import { loadConstraints } from '../../../../../_lib/analysis/operational-constraints.js'

export const config = { maxDuration: 60 }

const SYNTHESIZER_MODEL = 'claude-sonnet-4-5'

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
  const db = createAdminClient()

  let analysisId: string
  try {
    analysisId = await createAnalysisRecord(db, {
      account_id: accountId,
      client_id: clientId,
      module_key: 'synthesis',
      inputs: { snapshot_at: new Date().toISOString() },
      created_by: ctx.userId ?? null,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message ?? 'Failed to create analysis record' })
  }

  try {
    // Account name + property/SL counts (for the prompt)
    const { data: accRow } = await db
      .from('accounts')
      .select('id, name, display_name')
      .eq('id', accountId)
      .single()

    const constraints = await loadConstraints(db, accountId, clientId)
    const snapshots = await loadLatestModuleSnapshots(db, accountId, clientId)
    const properties = await loadAccountProperties(db, accountId, clientId)
    const slCount = properties.reduce(
      (sum, p) => sum + (p.service_locations?.length ?? 0),
      0
    )

    const synthesis = await runSynthesis({
      accountName: (accRow as any)?.display_name ?? (accRow as any)?.name ?? 'this account',
      propertyCount: properties.length,
      serviceLocationCount: slCount,
      snapshots,
      constraints,
      selectedBranches: constraints.selected_branches,
      selectedK: constraints.selected_k,
    })

    const presentModules = ALL_MODULE_KEYS.filter((k) => snapshots[k]?.status === 'completed')
    const missingModules = ALL_MODULE_KEYS.filter((k) => !snapshots[k])

    await completeAnalysisRecord(db, analysisId, {
      outputs: {
        full_report_markdown: synthesis.full_report_markdown,
        modules_synthesized: presentModules.map((k) => ({
          module_key: k,
          analysis_id: snapshots[k]!.id,
          completed_at: snapshots[k]!.completed_at,
        })),
        missing_modules: missingModules,
        snapshot_at: new Date().toISOString(),
      },
      summary_text: synthesis.dashboard_summary,
      property_count: properties.length,
    })

    return res.status(200).json({ analysis_id: analysisId, status: 'completed' })
  } catch (err: any) {
    const msg = err?.message ?? String(err)
    await failAnalysisRecord(db, analysisId, msg)
    return res.status(500).json({ analysis_id: analysisId, status: 'failed', error: msg })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reusable synthesis runner — also called by /scenarios/compute
// ─────────────────────────────────────────────────────────────────────────────

interface SynthesisInputs {
  accountName: string
  propertyCount: number
  serviceLocationCount: number
  snapshots: ModuleSnapshots
  constraints: any
  selectedBranches: any
  selectedK: number | null
}

export interface SynthesisResult {
  dashboard_summary: string
  full_report_markdown: string
}

const SYSTEM_PROMPT = `You are a senior operations analyst at a commercial janitorial company synthesizing a portfolio analysis for a bid response. You have access to outputs from up to 7 analyses: geographic_distribution, branch_optimization, drive_time_logistics, crew_strategy, workforce_sizing, seasonality_capacity, and bid_pricing_structure.

Your job is to produce:
1. A dashboard_summary (3–5 paragraphs of plain English, references specific numbers)
2. A full_report_markdown (markdown, sections specified below)

Rules:
- Cite specific numbers from the module outputs. NEVER invent numbers.
- If a module is missing, note it explicitly under "Missing Modules" and don't make up its conclusions.
- Be direct about risks and tradeoffs. Don't sugarcoat.
- "Recommended Strategy" picks a clear path: which crew option (A/B/C), which K, key risks.
- "Sensitivity Notes" calls out which assumptions matter most (e.g. "20% labor cost increase shifts bid by $X").

Format full_report_markdown with these sections (in order):
# Executive Summary
## Portfolio Overview
## Recommended Strategy
## Branch Decision
## Crew Strategy
## Workforce
## Seasonality
## Bid Pricing
## Risks & Considerations
## Sensitivity Notes

Phase 3.8 — building-count crew math:
- Crew Strategy now reports BOTH a conservative crew count (1 building = 1 crew-day, no pairing) AND an optimistic count (small adjacent properties paired in a single day). The conservative number is what to size the bid around; the optimistic is how low you could go if scheduling consistently shows the work fits.
- If both numbers exist and DIFFER, surface the range under "Risks & Considerations": e.g. "Crew sizing analysis shows X-Y crews depending on geographic packing efficiency. We recommend bidding at X crews to ensure capacity, with the option to scale down to Y if scheduling consistently shows the work fits." (replace X with the conservative count and Y with the optimistic count). This is typically a 6-figure-per-year swing — call it out.
- If a routing template exists for this client, the Bid Pricing module pulls crew_count from the actual scheduler plan ("source": "scheduler_template"). Mention this is the authoritative number; the Crew Strategy estimate is the pre-scheduler ceiling. If there is a meaningful delta between the two (>= 1 crew), note it: e.g. "Crew Strategy estimates 4 crews; the scheduler optimization confirms 3 crews are sufficient with current geographic packing."

Phase 3.9 — structured cost calculations:
- Branch overhead is now per-branch with main vs satellite designation. Each branch contributes its own (rent, utilities, manager-loaded, other) annual total. In the Branch Decision section, mention the count of mains vs satellites and any anomalies (e.g. a satellite carrying full main-branch overhead suggests it should be re-classified, a main with $0 manager suggests shared management).
- Insurance is calculated as % of bid revenue (default 1.5%) with a minimum premium. If \`hit_minimum\` is true, surface that in Risks: insurance was bumped to the minimum, so a small revenue change flips the value.
- Vehicle costs are per-crew with three ownership types (lease, purchase, personal_vehicle_reimbursement). If any crew uses personal vehicle reimbursement, mention liability/coverage considerations and that fuel cost has already been removed for those crews (the IRS mileage rate already covers gas + depreciation + maintenance).

Output strictly as JSON with two string keys: dashboard_summary, full_report_markdown.
Do NOT wrap the JSON in markdown code fences.`

async function runSynthesis(inputs: SynthesisInputs): Promise<SynthesisResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured')
  }

  const userPrompt = buildUserPrompt(inputs)
  const client = new Anthropic({ apiKey })

  const resp = await client.messages.create({
    model: SYNTHESIZER_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })

  // Pull the first text block
  const textBlock = resp.content.find((b: any) => b.type === 'text') as
    | { type: 'text'; text: string }
    | undefined
  if (!textBlock) {
    throw new Error('Synthesizer returned no text content')
  }

  const parsed = parseSynthesisJson(textBlock.text)
  return parsed
}

function buildUserPrompt(inputs: SynthesisInputs): string {
  const parts: string[] = []
  parts.push(`Account: ${inputs.accountName}`)
  parts.push(`Properties: ${inputs.propertyCount}`)
  parts.push(`Service locations: ${inputs.serviceLocationCount}`)
  if (inputs.selectedK != null) parts.push(`Selected K: ${inputs.selectedK}`)
  if (inputs.selectedBranches?.length) {
    parts.push(`Selected branches:`)
    for (const b of inputs.selectedBranches) {
      parts.push(`  - ${b.name} (${b.city_state ?? `${b.lat}, ${b.lng}`})`)
    }
  }

  const presentModules = ALL_MODULE_KEYS.filter(
    (k) => inputs.snapshots[k]?.status === 'completed'
  )
  const missingModules = ALL_MODULE_KEYS.filter((k) => !inputs.snapshots[k])

  parts.push('')
  parts.push(`Modules with completed runs: ${presentModules.join(', ') || 'none'}`)
  if (missingModules.length) {
    parts.push(`Modules MISSING (no completed run): ${missingModules.join(', ')}`)
    parts.push(`Note these in the "Missing Modules" section. Do not invent their results.`)
  }

  parts.push('')
  parts.push('--- Module outputs ---')
  for (const k of ALL_MODULE_KEYS) {
    const snap = inputs.snapshots[k]
    if (!snap) continue
    parts.push(`\n### ${k}`)
    parts.push(`summary: ${snap.summary_text ?? '(none)'}`)
    parts.push(`outputs: ${JSON.stringify(truncateOutputs(snap.outputs), null, 2)}`)
  }

  parts.push('')
  parts.push('--- Operational constraints ---')
  parts.push(JSON.stringify(redactedConstraints(inputs.constraints), null, 2))

  return parts.join('\n')
}

// Trim per-property arrays so the prompt stays under model token limits.
// The summary numbers (totals, counts, recommendations) are what synthesis
// needs; the per-property lists matter only for chat / detail views.
function truncateOutputs(o: any): any {
  if (!o || typeof o !== 'object') return o
  const clone: any = Array.isArray(o) ? [] : {}
  for (const [k, v] of Object.entries(o)) {
    if (Array.isArray(v) && v.length > 25) {
      clone[k] = [...v.slice(0, 25), `…+${v.length - 25} more (truncated)`]
    } else if (v && typeof v === 'object') {
      clone[k] = truncateOutputs(v)
    } else {
      clone[k] = v
    }
  }
  return clone
}

function redactedConstraints(c: any): any {
  if (!c || typeof c !== 'object') return c
  const { system_defaults, ...rest } = c
  return rest
}

// Pull the JSON object out of Claude's text response. Tolerates a leading
// preamble or trailing prose; finds the first balanced `{...}` and parses.
function parseSynthesisJson(raw: string): SynthesisResult {
  const trimmed = raw.trim()
  // Try direct parse first
  try {
    const j = JSON.parse(trimmed)
    if (j.dashboard_summary && j.full_report_markdown) {
      return {
        dashboard_summary: String(j.dashboard_summary),
        full_report_markdown: String(j.full_report_markdown),
      }
    }
  } catch {
    /* fall through */
  }

  // Find first '{' and the matching close brace
  const start = trimmed.indexOf('{')
  if (start < 0) {
    throw new Error('Synthesizer did not return JSON')
  }
  let depth = 0
  let inString = false
  let escape = false
  let end = -1
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (inString) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') inString = false
    } else {
      if (ch === '"') inString = true
      else if (ch === '{') depth += 1
      else if (ch === '}') {
        depth -= 1
        if (depth === 0) {
          end = i
          break
        }
      }
    }
  }
  if (end < 0) throw new Error('Synthesizer JSON was unterminated')

  const j = JSON.parse(trimmed.slice(start, end + 1))
  if (!j.dashboard_summary || !j.full_report_markdown) {
    throw new Error('Synthesizer JSON missing required fields')
  }
  return {
    dashboard_summary: String(j.dashboard_summary),
    full_report_markdown: String(j.full_report_markdown),
  }
}

// Exported for reuse by the scenario compute endpoint.
export { runSynthesis }
