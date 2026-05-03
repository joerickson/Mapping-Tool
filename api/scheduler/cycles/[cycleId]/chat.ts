// POST /api/scheduler/cycles/[cycleId]/chat
//
// Cycle chat with TOOL USE. The agent reads the cycle's full context
// AND can execute a small set of high-leverage actions through Claude's
// tool-use API:
//
//   apply_staging_rebalance — replace per-branch staging with the
//     optimal distribution computed from where the cycle actually
//     placed work. Use when the user wants to "spread out idle days,"
//     "rebalance crews," "fix overloaded branches," etc.
//
//   set_total_crews — change the total crew count, scaling per-branch
//     staging proportionally to match. For "use 13 crews instead of 14."
//
//   set_crews_at_branch — write a specific count for one branch. For
//     "move a crew from Lindon to Phoenix."
//
//   regenerate — re-run the template build + cycle. Required after any
//     staging change for the user to see the result.
//
// The endpoint loops on tool calls until the model emits stop_reason
// === 'end_turn'. Each tool result is fed back into the conversation
// so the LLM can chain (e.g. apply_staging_rebalance → regenerate →
// summarize what changed).
import type { VercelRequest, VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest, type AuthContext } from '../../../_lib/auth.js'
import { haversineMiles } from '../../../_lib/analysis/haversine.js'

export const config = { maxDuration: 120 }

const CHAT_MODEL = 'claude-sonnet-4-5'
const MAX_TOKENS = 2000
const MAX_TOOL_LOOPS = 6

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ToolEvent {
  tool: string
  input: Record<string, unknown>
  result: { ok: boolean; summary: string; data?: unknown }
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'apply_staging_rebalance',
    description:
      'Replace the entire per-branch crew staging with the optimal distribution computed from where the cycle actually placed work. Use when the operator wants to spread idle days more evenly, fix overloaded branches, or stop oscillation between branches. After this call, the operator must regenerate to see the effect — call the `regenerate` tool after to converge.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'set_total_crews',
    description:
      'Change the total crew count for this client, scaling per-branch staging proportionally. Use for "drop to 13 crews," "add a crew," etc. Total must be a positive integer. Call `regenerate` after.',
    input_schema: {
      type: 'object',
      properties: {
        total: { type: 'number', description: 'New total crew count, integer ≥ 1' },
      },
      required: ['total'],
    },
  },
  {
    name: 'set_crews_at_branch',
    description:
      'Set the number of crews home-based at a specific branch. Use for "add a crew to Phoenix," "move 2 crews from Lindon." Branch name must match an existing branch on the template (case-insensitive). Count is an integer ≥ 0; 0 removes that branch from staging. Call `regenerate` after.',
    input_schema: {
      type: 'object',
      properties: {
        branch_name: { type: 'string' },
        count: { type: 'number' },
      },
      required: ['branch_name', 'count'],
    },
  },
  {
    name: 'regenerate',
    description:
      'Re-run the routing template build with current constraints, then re-derive THIS cycle from the new template. Required after any staging change for the operator to see the result. Returns a brief summary of the new cycle (placed/unplaced counts, crew count).',
    input_schema: { type: 'object', properties: {} },
  },
]

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  let ctx: AuthContext
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const cycleId = req.query.cycleId as string
  if (!cycleId) return res.status(400).json({ error: 'cycleId required' })

  const body = (req.body ?? {}) as { messages?: ChatMessage[] }
  const messages = Array.isArray(body.messages) ? body.messages : []
  if (messages.length === 0) return res.status(400).json({ error: 'messages required' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' })

  const db = createAdminClient()

  // ── Load cycle context ────────────────────────────────────────────
  const { data: cycle } = await db
    .from('cycle_instances')
    .select('*')
    .eq('id', cycleId)
    .maybeSingle()
  if (!cycle) return res.status(404).json({ error: 'Cycle not found' })

  const { data: tplRow } = cycle.template_id
    ? await db.from('routing_templates').select('*').eq('id', cycle.template_id).maybeSingle()
    : { data: null }
  const template = tplRow as any
  const accountId = template?.account_id as string | undefined
  const clientId = template?.client_id as string | undefined
  const branches = ((template?.branches ?? []) as Array<{ name: string; lat: number; lng: number }>) ?? []

  // Page through visits + crew_days.
  const PAGE = 1000
  const visits: any[] = []
  for (let p = 0; p < 50; p++) {
    const { data } = await db
      .from('scheduled_visits')
      .select('id, status, scheduled_date, hours_per_visit_total, unplaced_reason, service_locations(display_name, property:properties(latitude, longitude, address_line1))')
      .eq('cycle_instance_id', cycleId)
      .range(p * PAGE, (p + 1) * PAGE - 1)
    const batch = data ?? []
    visits.push(...batch)
    if (batch.length < PAGE) break
  }
  const crewDays: any[] = []
  for (let p = 0; p < 50; p++) {
    const { data } = await db
      .from('crew_day_routes')
      .select('id, crew_index, crew_label, scheduled_date, day_type, total_work_minutes, total_drive_minutes, route, trip_label')
      .eq('cycle_instance_id', cycleId)
      .range(p * PAGE, (p + 1) * PAGE - 1)
    const batch = data ?? []
    crewDays.push(...batch)
    if (batch.length < PAGE) break
  }

  // ── System prompt (advisory body + tool use guidance) ─────────────
  const placed = visits.filter((v) => v.status === 'placed').length
  const completed = visits.filter((v) => v.status === 'completed').length
  const unplaced = visits.filter((v) => v.status === 'unplaced')
  const required = template?.total_visits_required_per_cycle ?? visits.length

  const crewDaysByCrew = new Map<number, any[]>()
  for (const cd of crewDays) {
    const arr = crewDaysByCrew.get(cd.crew_index) ?? []
    arr.push(cd)
    crewDaysByCrew.set(cd.crew_index, arr)
  }
  const perCrew: Array<{
    crew_index: number
    crew_label: string
    days: number
    work_hours: number
    drive_hours: number
    end_date: string
    pair_rate: number
  }> = []
  for (const [crewIdx, list] of crewDaysByCrew) {
    list.sort((a, b) => (a.scheduled_date ?? '').localeCompare(b.scheduled_date ?? ''))
    const workHours = list.reduce((s, d) => s + (d.total_work_minutes ?? 0) / 60, 0)
    const driveHours = list.reduce((s, d) => s + (d.total_drive_minutes ?? 0) / 60, 0)
    const paired = list.filter((d) => Array.isArray(d.route) && d.route.length >= 2).length
    perCrew.push({
      crew_index: crewIdx,
      crew_label: list[0]?.crew_label ?? `Crew ${crewIdx + 1}`,
      days: list.length,
      work_hours: Math.round(workHours * 10) / 10,
      drive_hours: Math.round(driveHours * 10) / 10,
      end_date: list[list.length - 1]?.scheduled_date ?? '',
      pair_rate: list.length > 0 ? Math.round((paired / list.length) * 100) : 0,
    })
  }
  perCrew.sort((a, b) => a.crew_index - b.crew_index)

  const unplacedSample = unplaced.slice(0, 25).map((v) => ({
    address:
      v.service_locations?.property?.address_line1 ??
      v.service_locations?.display_name ??
      v.id,
    reason: v.unplaced_reason ?? 'unknown',
  }))

  const branchNames = branches.map((b) => b.name).filter(Boolean)

  const systemPrompt = `You are a senior scheduling analyst working alongside a janitorial operations team. You have READ access to the cycle's data AND a small set of TOOLS that change the schedule.

When the user expresses an intent that maps to a tool, USE THE TOOL. Don't just describe what to do — do it. Then briefly say what changed and what the next step is.

Examples of tool-actionable intents:
- "spread out idle days" / "rebalance crews" → apply_staging_rebalance, then regenerate
- "drop to 13 crews" / "add 2 crews" → set_total_crews, then regenerate
- "move a crew from X to Y" → set_crews_at_branch (twice — decrement X, increment Y), then regenerate
- After ANY staging change: ALWAYS call regenerate so the user sees the effect

Cycle: ${cycle.cycle_number ? `#${cycle.cycle_number}` : cycle.id}
Date range: ${cycle.start_date} → ${cycle.end_date}
Crew count (template): ${template?.crew_count ?? 'unknown'}
Branches available for tool calls: ${branchNames.join(', ') || '(none — staging tools will fail)'}

Coverage:
- Required visits per cycle (template): ${required}
- Visits in DB: ${visits.length}
- Placed: ${placed}
- Completed: ${completed}
- Unplaced (in cycle, status=unplaced): ${unplaced.length}
- Dropped before reaching cycle (template build couldn't fit): ${Math.max(0, required - visits.length)}

Per-crew:
${perCrew
  .map(
    (c) =>
      `- ${c.crew_label}: ${c.days} workdays, ${c.work_hours}h work + ${c.drive_hours}h drive, ${c.pair_rate}% paired, ends ${c.end_date}`
  )
  .join('\n')}

${
  template?.pacing_analysis
    ? `Pacing analysis:
- Crew end-workday spread: ${template.pacing_analysis.crew_end_workday_spread} (target ≤${template.pacing_analysis.target_spread_workdays})
- Global pair rate: ${template.pacing_analysis.pairing_stats?.pair_rate_pct}% (${template.pacing_analysis.pairing_stats?.paired_days} paired / ${template.pacing_analysis.pairing_stats?.total_workdays} total)
`
    : ''
}${
  Array.isArray(template?.warnings) && template.warnings.length > 0
    ? `Engine warnings:
${template.warnings.map((w: any) => `- ${w.message}${w.suggested_action ? ` (try: ${w.suggested_action})` : ''}`).join('\n')}
`
    : ''
}${
  unplacedSample.length > 0
    ? `Unplaced sample (${unplaced.length} total, showing first ${unplacedSample.length}):
${unplacedSample.map((u) => `- ${u.address} — ${u.reason}`).join('\n')}
`
    : ''
}

Rules:
- Cite specific numbers from above; never invent metrics.
- For tool calls: explain briefly BEFORE calling, execute, then summarize the result.
- Don't ask for confirmation on staging changes — the user already asked you to do it. Just do it and report back.
- After ANY staging change, always finish with a regenerate call so the user sees the result without manual intervention.
- Keep prose tight — the user is scanning, not reading.`

  // ── Tool execution helpers ────────────────────────────────────────
  const executeTool = async (name: string, input: Record<string, unknown>): Promise<ToolEvent['result']> => {
    if (!accountId || !clientId) {
      return { ok: false, summary: 'Cannot execute: cycle has no client/account context.' }
    }
    try {
      // Read-modify-write helper for the override map.
      const readOverride = async (): Promise<Record<string, number>> => {
        const { data } = await db
          .from('account_operational_constraints')
          .select('crew_count_per_branch_override')
          .eq('account_id', accountId)
          .eq('client_id', clientId)
          .maybeSingle()
        const raw = ((data as any)?.crew_count_per_branch_override ?? {}) as Record<string, number>
        const cleaned: Record<string, number> = {}
        for (const [k, v] of Object.entries(raw)) {
          if (k === '__roving') continue
          const n = Math.floor(Number(v) || 0)
          if (n > 0) cleaned[k] = n
        }
        return cleaned
      }
      const writeOverride = async (next: Record<string, number>) => {
        await db
          .from('account_operational_constraints')
          .upsert(
            {
              account_id: accountId,
              client_id: clientId,
              crew_count_per_branch_override: next,
              updated_at: new Date().toISOString(),
              updated_by: ctx.userId ?? null,
            },
            { onConflict: 'account_id,client_id' }
          )
      }
      // Resolve a branch name to its canonical form (case-insensitive).
      const resolveBranchName = (name: string): string | null => {
        if (!name) return null
        const exact = branches.find((b) => b.name === name)
        if (exact) return exact.name
        const ci = branches.find((b) => b.name.toLowerCase() === name.toLowerCase())
        return ci ? ci.name : null
      }

      if (name === 'apply_staging_rebalance') {
        // Compute the optimal distribution from cycle placements.
        const counts = new Array(branches.length).fill(0)
        let total = 0
        for (const v of visits) {
          const lat = v.service_locations?.property?.latitude
          const lng = v.service_locations?.property?.longitude
          if (typeof lat !== 'number' || typeof lng !== 'number') continue
          let bestIdx = 0
          let best = Number.POSITIVE_INFINITY
          for (let i = 0; i < branches.length; i++) {
            const d = haversineMiles({ lat, lng }, branches[i])
            if (d < best) { best = d; bestIdx = i }
          }
          counts[bestIdx]++
          total++
        }
        if (total === 0) {
          return { ok: false, summary: 'No placed visits with coordinates — cannot compute a distribution.' }
        }
        const crewCount = template?.crew_count ?? 1
        const real = counts.map((c) => (c / total) * crewCount)
        const floors = real.map((r) => Math.floor(r))
        const remainders = real.map((r, i) => ({ idx: i, frac: r - floors[i] }))
        let allocated = floors.reduce((s, n) => s + n, 0)
        remainders.sort((a, b) => b.frac - a.frac)
        let r = 0
        while (allocated < crewCount && r < remainders.length) {
          floors[remainders[r].idx]++
          allocated++
          r++
        }
        const next: Record<string, number> = {}
        for (let i = 0; i < branches.length; i++) {
          if (floors[i] > 0) next[branches[i].name] = floors[i]
        }
        await writeOverride(next)
        return {
          ok: true,
          summary: `Applied optimal staging: ${Object.entries(next).map(([k, v]) => `${k}: ${v}`).join(', ')}.`,
          data: { proposed_per_branch: next },
        }
      }

      if (name === 'set_total_crews') {
        const target = Math.max(1, Math.floor(Number(input.total)))
        if (!Number.isFinite(target) || target < 1) {
          return { ok: false, summary: `Invalid total: ${String(input.total)}` }
        }
        const cur = await readOverride()
        const curSum = Object.values(cur).reduce((s, n) => s + n, 0)
        let next: Record<string, number>
        if (curSum === target || curSum === 0) {
          next = cur
        } else {
          // Largest-remainder scaling.
          const scale = target / curSum
          const real: Record<string, number> = {}
          const floors: Array<{ key: string; floor: number; rem: number }> = []
          let alloc = 0
          for (const [k, v] of Object.entries(cur)) {
            real[k] = v * scale
            const f = Math.floor(real[k])
            floors.push({ key: k, floor: f, rem: real[k] - f })
            alloc += f
          }
          floors.sort((a, b) => b.rem - a.rem)
          let i = 0
          while (alloc < target && i < floors.length) {
            floors[i].floor++
            alloc++
            i++
          }
          if (alloc > target) {
            floors.sort((a, b) => a.floor - b.floor)
            let j = 0
            while (alloc > target && j < floors.length) {
              if (floors[j].floor > 0) {
                floors[j].floor--
                alloc--
              }
              j++
            }
          }
          next = {}
          for (const f of floors) {
            if (f.floor > 0) next[f.key] = f.floor
          }
        }
        await writeOverride(next)
        return {
          ok: true,
          summary: `Set total crews to ${target}. Distribution: ${Object.entries(next).map(([k, v]) => `${k}: ${v}`).join(', ')}.`,
          data: { proposed_per_branch: next, total: target },
        }
      }

      if (name === 'set_crews_at_branch') {
        const branchName = resolveBranchName(String(input.branch_name ?? ''))
        if (!branchName) {
          return {
            ok: false,
            summary: `Branch "${String(input.branch_name)}" not found. Available: ${branchNames.join(', ')}.`,
          }
        }
        const count = Math.max(0, Math.floor(Number(input.count)))
        if (!Number.isFinite(count)) {
          return { ok: false, summary: `Invalid count: ${String(input.count)}` }
        }
        const cur = await readOverride()
        const next = { ...cur }
        if (count === 0) delete next[branchName]
        else next[branchName] = count
        await writeOverride(next)
        return {
          ok: true,
          summary: `Set ${branchName} to ${count} crew${count === 1 ? '' : 's'}.`,
          data: { branch_name: branchName, count, total: Object.values(next).reduce((s, n) => s + n, 0) },
        }
      }

      if (name === 'regenerate') {
        if (!cycle.template_id) {
          return { ok: false, summary: 'Cycle has no template — cannot regenerate.' }
        }
        const baseUrl = `${req.headers['x-forwarded-proto'] ?? 'https'}://${req.headers.host}`
        const auth = req.headers.authorization ?? ''
        const tplRes = await fetch(
          `${baseUrl}/api/scheduler/templates/${cycle.template_id}/regenerate`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: auth },
            body: JSON.stringify({}),
          }
        )
        if (!tplRes.ok) {
          const j = await tplRes.json().catch(() => ({}))
          return { ok: false, summary: `Template regen failed: ${(j as any).error ?? tplRes.status}` }
        }
        const cycleRes = await fetch(
          `${baseUrl}/api/scheduler/templates/${cycle.template_id}/generate-cycle`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: auth },
            body: JSON.stringify({
              start_date: cycle.start_date,
              cycle_number: cycle.cycle_number,
              apply_template_changes: true,
            }),
          }
        )
        if (!cycleRes.ok) {
          const j = await cycleRes.json().catch(() => ({}))
          return { ok: false, summary: `Cycle regen failed: ${(j as any).error ?? cycleRes.status}` }
        }
        return {
          ok: true,
          summary:
            'Template + cycle regenerated. Reload the page to see the updated schedule.',
        }
      }

      return { ok: false, summary: `Unknown tool: ${name}` }
    } catch (err) {
      return { ok: false, summary: `Tool error: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  // ── Conversation loop with tool use ───────────────────────────────
  const anthropic = new Anthropic({ apiKey })
  // Build the API-shape message list. We append assistant tool_use
  // turns and user tool_result turns as we go.
  const apiMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }))
  const events: ToolEvent[] = []
  let finalText = ''
  try {
    for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
      const response = await anthropic.messages.create({
        model: CHAT_MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        tools: TOOLS,
        messages: apiMessages,
      })
      // Accumulate text from this turn.
      const textBlocks = response.content.filter((b: any) => b.type === 'text')
      const turnText = textBlocks.map((b: any) => b.text).join('\n')
      if (turnText) finalText = finalText ? `${finalText}\n\n${turnText}` : turnText

      if (response.stop_reason !== 'tool_use') break

      // Execute each requested tool, append assistant + tool_result turns.
      const toolUseBlocks = response.content.filter((b: any) => b.type === 'tool_use')
      apiMessages.push({ role: 'assistant', content: response.content as any })
      const toolResults: any[] = []
      for (const tu of toolUseBlocks as any[]) {
        const result = await executeTool(tu.name, tu.input ?? {})
        events.push({ tool: tu.name, input: tu.input ?? {}, result })
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result),
          is_error: !result.ok,
        })
      }
      apiMessages.push({ role: 'user', content: toolResults })
    }
    return res.status(200).json({ message: finalText, events })
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'Chat failed' })
  }
}
