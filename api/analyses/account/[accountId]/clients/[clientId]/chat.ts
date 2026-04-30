// /api/analyses/account/[accountId]/chat
//   GET  — returns the persisted thread for this account (last 50 messages)
//   POST — sends a user message; runs the assistant with tool access until a
//          final text response comes back. Persists user message + final
//          assistant message + any intermediate tool calls.
//
// Available tools (executed server-side):
//   get_module_output(module_key)   → outputs of one module's latest run
//   list_properties(filter, sort_by?, limit?) → matching properties
//   simulate_scenario(overrides, modules_to_run?) → run runAllModules with
//     overrides, return the result. Doesn't persist.
//   save_scenario(name, description?, overrides, module_results)
//   apply_to_constraints(scenario_id?, overrides?, confirm)
//     — REQUIRES confirm=true; otherwise returns a confirmation request that
//       the dashboard renders as a card.
//
// Non-streaming for v1: the chat tool loop runs to completion server-side and
// the dashboard receives a single final assistant text response.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '../../../../../_lib/supabase.js'
import { authenticateRequest } from '../../../../../_lib/auth.js'
import {
  loadConstraints,
} from '../../../../../_lib/analysis/operational-constraints.js'
import {
  loadAccountProperties,
} from '../../../../../_lib/analysis/account-data.js'
import {
  loadLatestModuleSnapshots,
  ALL_MODULE_KEYS,
} from '../../../../../_lib/analysis/load-all-modules.js'
import {
  runAllModules,
  type ScenarioOverrides,
} from '../../../../../_lib/analysis/run-all-modules.js'

export const config = { maxDuration: 90 }

const CHAT_MODEL = 'claude-sonnet-4-5'
const MAX_TOOL_TURNS = 6

const SYSTEM_PROMPT_TEMPLATE = (ctx: {
  accountName: string
  propertyCount: number
  selectedK: number | null
  branchSummary: string
}) => `You are a senior operations analyst helping a janitorial bid team understand their portfolio analysis. You have access to:

- Up to 7 analysis modules' latest outputs via the get_module_output tool
- The account's operational constraints (labor rates, fuel cost, branch overhead, etc.)
- The user's selected branches and K
- Tools to query specific module outputs, list properties, simulate scenarios, save scenarios, and (with confirmation) apply changes to constraints

Rules:
- Always cite specific numbers from the data, never invent numbers
- For complex what-if questions, USE the simulate_scenario tool rather than guessing
- For applying any constraint change permanently, ALWAYS show a confirmation summary first and call apply_to_constraints with confirm=false on the first turn. The dashboard renders a confirmation card and the user replies with "yes apply" / "apply it" / etc. Only then call apply_to_constraints with confirm=true.
- Be direct about tradeoffs and risks
- Don't be verbose — answer the question, then offer to dig deeper if useful

Account context:
- Account: ${ctx.accountName}
- Property count: ${ctx.propertyCount}
- Selected K: ${ctx.selectedK ?? 'not selected'}
- Branches: ${ctx.branchSummary || '(none)'}`

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_module_output',
    description:
      'Get the full structured output of a specific analysis module from its most recent completed run. Use this when the user asks about specifics from a particular module.',
    input_schema: {
      type: 'object' as const,
      properties: {
        module_key: {
          type: 'string',
          enum: ALL_MODULE_KEYS as unknown as string[],
        },
      },
      required: ['module_key'],
    },
  },
  {
    name: 'list_properties',
    description:
      'List properties for the account, optionally sorted (e.g. by drive_time_minutes desc) and limited. Use to answer "which 5 properties contribute the most to drive cost" type questions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sort_by: {
          type: 'string',
          description: 'One of: drive_time_minutes, sqft, address. drive_time_minutes pulls from the latest drive_time_logistics run.',
        },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'simulate_scenario',
    description:
      'Run a hypothetical scenario by overriding constraints. Returns recomputed module results WITHOUT persisting. Use this for what-if questions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        overrides: {
          type: 'object',
          description:
            'Object with override fields. Supported: hourly_loaded_labor_cost, fuel_cost_per_mile, target_gross_margin_pct, surge_premium_multiplier, branch_overhead_annual, hotels_annual, vehicle_lease_annual_per_crew, supplies_pct_of_labor, insurance_annual, corporate_overhead_pct, drive_speed_mph, max_one_way_drive_minutes, k_override (number), drop_branch_indices (number[]), excluded_property_ids (string[])',
        },
        modules_to_run: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional. Defaults to all 7 modules.',
        },
      },
      required: ['overrides'],
    },
  },
  {
    name: 'save_scenario',
    description:
      'Save a scenario with a name. Use when user explicitly says they want to save / remember this scenario.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        overrides: { type: 'object' },
        module_results: { type: 'object' },
      },
      required: ['name', 'overrides'],
    },
  },
  {
    name: 'apply_to_constraints',
    description:
      "Apply a scenario's overrides to the account constraints permanently. CRITICAL: First call this with confirm=false to get the diff, then describe it to the user and ask for explicit confirmation. Only call with confirm=true after the user explicitly says yes.",
    input_schema: {
      type: 'object' as const,
      properties: {
        scenario_id: { type: 'string' },
        overrides: { type: 'object' },
        confirm: { type: 'boolean' },
      },
      required: ['confirm'],
    },
  },
]

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
    const { data } = await db
      .from('analysis_chat_messages')
      .select('id, role, content, metadata, created_at')
      .eq('account_id', accountId)
      .eq('client_id', clientId)
      .order('created_at', { ascending: true })
      .limit(50)
    return res.status(200).json(data ?? [])
  }

  if (req.method === 'DELETE') {
    await db.from('analysis_chat_messages').delete().eq('account_id', accountId).eq('client_id', clientId)
    return res.status(200).json({ ok: true })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const body = (req.body ?? {}) as { message?: string }
  const userMessage = (body.message ?? '').trim()
  if (!userMessage) return res.status(400).json({ error: 'message is required' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured' })
  }

  // Persist user message immediately so the thread reads correctly even if
  // the assistant turn errors out.
  await db.from('analysis_chat_messages').insert({
    account_id: accountId,
    client_id: clientId,
    role: 'user',
    content: userMessage,
  })

  // Build system prompt context
  const { data: accRow } = await db
    .from('accounts')
    .select('name, display_name')
    .eq('id', accountId)
    .single()
  const accountName =
    (accRow as any)?.display_name ?? (accRow as any)?.name ?? 'this account'

  const constraints = await loadConstraints(db, accountId, clientId)
  const properties = await loadAccountProperties(db, accountId, clientId)
  const branchSummary = (constraints.selected_branches ?? [])
    .map((b: any) => b.name)
    .join(', ')

  const systemPrompt = SYSTEM_PROMPT_TEMPLATE({
    accountName,
    propertyCount: properties.length,
    selectedK: constraints.selected_k,
    branchSummary,
  })

  // Build conversation history
  const { data: priorMsgs } = await db
    .from('analysis_chat_messages')
    .select('role, content, metadata, created_at')
    .eq('account_id', accountId)
    .eq('client_id', clientId)
    .order('created_at', { ascending: true })
    .limit(50)

  // Convert history into Anthropic messages format
  const messages: Anthropic.MessageParam[] = []
  for (const m of (priorMsgs ?? []) as any[]) {
    if (m.role === 'system') continue
    if (m.role === 'user') {
      messages.push({ role: 'user', content: m.content })
    } else if (m.role === 'assistant') {
      messages.push({ role: 'assistant', content: m.content })
    }
  }

  const client = new Anthropic({ apiKey })
  const toolCallTrace: Array<{ name: string; input: any; result: any }> = []

  let finalAssistantText = ''
  let pendingApplyConfirmation: any = null

  try {
    // Tool loop
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const resp = await client.messages.create({
        model: CHAT_MODEL,
        max_tokens: 2048,
        system: systemPrompt,
        tools: TOOLS,
        messages,
      })

      // Add the assistant turn to messages
      messages.push({ role: 'assistant', content: resp.content })

      // Find any tool_use blocks
      const toolUses = resp.content.filter(
        (b: any) => b.type === 'tool_use'
      ) as Anthropic.ToolUseBlock[]
      const textBlocks = resp.content.filter(
        (b: any) => b.type === 'text'
      ) as Anthropic.TextBlock[]

      if (toolUses.length === 0 || resp.stop_reason !== 'tool_use') {
        finalAssistantText = textBlocks.map((b) => b.text).join('\n').trim()
        break
      }

      // Execute every tool_use; append results
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const tu of toolUses) {
        const exec = await executeTool(tu.name, tu.input as any, {
          db,
          accountId,
          clientId,
          ctxUserId: ctx.userId ?? null,
          constraints,
          properties,
        })
        toolCallTrace.push({ name: tu.name, input: tu.input, result: exec.summary })
        if (tu.name === 'apply_to_constraints' && exec.full?.confirmation_required) {
          pendingApplyConfirmation = exec.full
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(exec.full).slice(0, 32_000),
        })
      }
      messages.push({ role: 'user', content: toolResults })
    }
  } catch (err: any) {
    const msg = err?.message ?? String(err)
    await db.from('analysis_chat_messages').insert({
      account_id: accountId,
      client_id: clientId,
      role: 'assistant',
      content: `Sorry — I hit an error while reasoning: ${msg}`,
      metadata: { error: msg, tool_calls: toolCallTrace },
    })
    return res.status(200).json({
      role: 'assistant',
      content: `Sorry — I hit an error while reasoning: ${msg}`,
      tool_calls: toolCallTrace,
    })
  }

  // Persist final assistant message
  const assistantPayload = {
    role: 'assistant' as const,
    content: finalAssistantText || '(no response)',
    metadata: {
      tool_calls: toolCallTrace,
      pending_apply_confirmation: pendingApplyConfirmation,
    },
  }
  await db.from('analysis_chat_messages').insert({
    account_id: accountId,
    client_id: clientId,
    role: assistantPayload.role,
    content: assistantPayload.content,
    metadata: assistantPayload.metadata,
  })

  return res.status(200).json(assistantPayload)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool execution
// ─────────────────────────────────────────────────────────────────────────────

interface ToolCtx {
  db: any
  accountId: string
  clientId: string
  ctxUserId: string | null
  constraints: any
  properties: any[]
}

async function executeTool(
  name: string,
  input: any,
  c: ToolCtx
): Promise<{ summary: any; full: any }> {
  try {
    switch (name) {
      case 'get_module_output': {
        const snaps = await loadLatestModuleSnapshots(c.db, c.accountId, c.clientId)
        const snap = snaps[input.module_key as keyof typeof snaps]
        if (!snap) {
          return {
            summary: { module_key: input.module_key, found: false },
            full: { found: false, message: `No completed run for ${input.module_key}` },
          }
        }
        return {
          summary: { module_key: input.module_key, found: true },
          full: {
            module_key: input.module_key,
            outputs: snap.outputs,
            summary_text: snap.summary_text,
            completed_at: snap.completed_at,
          },
        }
      }

      case 'list_properties': {
        const limit = Math.min(Number(input.limit) || 10, 50)
        const sortBy = String(input.sort_by ?? 'sqft')
        let rows = c.properties.map((p) => ({
          id: p.id,
          address: p.address_line1,
          city: p.city,
          state: p.state,
          sqft: p.service_locations.reduce(
            (s: number, sl: any) => s + (sl.serviceable_sqft ?? 0),
            0
          ),
          drive_time_minutes: 0,
        }))
        // Augment with drive time if available
        const snaps = await loadLatestModuleSnapshots(c.db, c.accountId, c.clientId)
        const drive = snaps.drive_time_logistics?.outputs?.per_property
        if (Array.isArray(drive)) {
          const byId = new Map(
            drive.map((p: any) => [p.property_id, p.drive_time_minutes])
          )
          rows = rows.map((r) => ({
            ...r,
            drive_time_minutes: byId.get(r.id) ?? 0,
          }))
        }

        if (sortBy === 'drive_time_minutes') rows.sort((a, b) => b.drive_time_minutes - a.drive_time_minutes)
        else if (sortBy === 'sqft') rows.sort((a, b) => b.sqft - a.sqft)
        else if (sortBy === 'address') rows.sort((a, b) => a.address.localeCompare(b.address))

        const sliced = rows.slice(0, limit)
        return {
          summary: { count: sliced.length, sort_by: sortBy },
          full: { properties: sliced, total: rows.length, sort_by: sortBy },
        }
      }

      case 'simulate_scenario': {
        const overrides = (input.overrides ?? {}) as ScenarioOverrides
        const modulesToRun = input.modules_to_run as any[] | undefined
        const baseline = await loadConstraints(c.db, c.accountId, c.clientId)
        const results = await runAllModules(c.db, c.accountId, c.clientId, {
          baselineConstraints: baseline,
          overrides,
          modulesToRun: modulesToRun as any,
        })
        return {
          summary: {
            modules_recomputed: Object.keys(results),
            bid_total:
              (results as any).bid_pricing_structure?.outputs?.bid_total ?? null,
          },
          full: {
            module_results: results,
            // Include baseline numbers for comparison context
            baseline_summary: {
              bid_total:
                baseline.selected_branches
                  ? (await loadLatestModuleSnapshots(c.db, c.accountId, c.clientId))
                      .bid_pricing_structure?.outputs?.bid_total ?? null
                  : null,
            },
          },
        }
      }

      case 'save_scenario': {
        const baseline = await loadConstraints(c.db, c.accountId, c.clientId)
        const { data, error } = await c.db
          .from('analysis_scenarios')
          .insert({
            account_id: c.accountId,
            client_id: c.clientId,
            name: input.name,
            description: input.description ?? null,
            constraints_snapshot: baseline,
            overrides: input.overrides ?? {},
            module_results: input.module_results ?? {},
            created_by: c.ctxUserId,
          })
          .select('id, name')
          .single()
        if (error) throw new Error(error.message)
        return {
          summary: { saved: true, scenario_id: (data as any).id },
          full: { saved: true, scenario: data },
        }
      }

      case 'apply_to_constraints': {
        const confirm = input.confirm === true
        const overrides =
          input.overrides ??
          (input.scenario_id
            ? (
                await c.db
                  .from('analysis_scenarios')
                  .select('overrides')
                  .eq('id', input.scenario_id)
                  .eq('account_id', c.accountId)
                  .eq('client_id', c.clientId)
                  .single()
              ).data?.overrides
            : null) ??
          {}

        const baseline = await loadConstraints(c.db, c.accountId, c.clientId)
        const NUMERIC_KEYS: string[] = [
          'crew_size','hours_per_day','hourly_loaded_labor_cost',
          'project_clean_base_hours','project_clean_hours_per_sqft',
          'upholstery_solo_hours','upholstery_combo_hours_pct',
          'recurring_productivity_sqft_per_hour',
          'fuel_cost_per_mile','vehicles_per_crew',
          'surge_weeks_per_year','surge_crew_count','surge_premium_multiplier',
          'branch_overhead_annual','hotels_annual','vehicle_lease_annual_per_crew',
          'supplies_pct_of_labor','insurance_annual',
          'corporate_overhead_pct','target_gross_margin_pct',
          'drive_speed_mph','max_one_way_drive_minutes',
        ]
        const diff: Array<{ key: string; from: any; to: any }> = []
        for (const k of NUMERIC_KEYS) {
          if (k in overrides) {
            const to = (overrides as any)[k]
            const from = (baseline as any)[k]
            if (typeof to === 'number' && from !== to) diff.push({ key: k, from, to })
          }
        }

        if (!confirm) {
          return {
            summary: { confirmation_required: true, change_count: diff.length },
            full: {
              confirmation_required: true,
              diff,
              message: `Apply ${diff.length} constraint change${diff.length === 1 ? '' : 's'}? Tier 2 analyses will be marked stale.`,
            },
          }
        }

        if (diff.length === 0) {
          return { summary: { applied: false }, full: { applied: false, message: 'No changes to apply.' } }
        }

        const upsert: Record<string, unknown> = {
          account_id: c.accountId,
          client_id: c.clientId,
          updated_at: new Date().toISOString(),
          updated_by: c.ctxUserId,
        }
        for (const d of diff) upsert[d.key] = d.to
        const { error } = await c.db
          .from('account_operational_constraints')
          .upsert(upsert, { onConflict: 'account_id,client_id' })
        if (error) throw new Error(error.message)
        return {
          summary: { applied: true, change_count: diff.length },
          full: { applied: true, diff },
        }
      }

      default:
        return {
          summary: { error: `Unknown tool: ${name}` },
          full: { error: `Unknown tool: ${name}` },
        }
    }
  } catch (err: any) {
    return {
      summary: { error: err?.message ?? String(err) },
      full: { error: err?.message ?? String(err) },
    }
  }
}
