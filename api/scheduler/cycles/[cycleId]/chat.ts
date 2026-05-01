// POST /api/scheduler/cycles/[cycleId]/chat
//
// Phase 4.5 — advisory cycle chat. Loads the cycle's full context (visits,
// crew_days, utilization, template metadata, branches, unplaced) and
// passes a condensed system prompt + the user's message history to
// Anthropic's API. The agent can suggest moves but cannot execute —
// users still go to the existing scheduler UI to apply changes.
//
// Body: { messages: [{ role: 'user' | 'assistant', content: string }] }
import type { VercelRequest, VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'

export const config = { maxDuration: 60 }

const CHAT_MODEL = 'claude-sonnet-4-5'
const MAX_TOKENS = 1500

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const cycleId = req.query.cycleId as string
  if (!cycleId) return res.status(400).json({ error: 'cycleId required' })

  const body = (req.body ?? {}) as { messages?: ChatMessage[] }
  const messages = Array.isArray(body.messages) ? body.messages : []
  if (messages.length === 0) return res.status(400).json({ error: 'messages required' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' })
  }

  const db = createAdminClient()

  // ── Load cycle context ────────────────────────────────────────────
  const { data: cycle } = await db
    .from('cycle_instances')
    .select('*')
    .eq('id', cycleId)
    .maybeSingle()
  if (!cycle) return res.status(404).json({ error: 'Cycle not found' })

  // Page through visits + crew_days (PostgREST cap protection).
  const PAGE = 1000
  const visits: any[] = []
  for (let p = 0; p < 50; p++) {
    const { data } = await db
      .from('scheduled_visits')
      .select('id, status, scheduled_date, hours_per_visit_total, unplaced_reason, service_locations(display_name, property:properties(address_line1))')
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
      .select('id, crew_index, crew_label, scheduled_date, day_type, total_work_minutes, total_drive_minutes, total_day_minutes, route, trip_label')
      .eq('cycle_instance_id', cycleId)
      .range(p * PAGE, (p + 1) * PAGE - 1)
    const batch = data ?? []
    crewDays.push(...batch)
    if (batch.length < PAGE) break
  }

  // Template — for branches, crew_count, pacing_analysis, warnings, required count.
  let template: any = null
  if (cycle.template_id) {
    const { data } = await db
      .from('routing_templates')
      .select('*')
      .eq('id', cycle.template_id)
      .maybeSingle()
    template = data ?? null
  }

  // ── Build system prompt ───────────────────────────────────────────
  const placed = visits.filter((v) => v.status === 'placed').length
  const completed = visits.filter((v) => v.status === 'completed').length
  const unplaced = visits.filter((v) => v.status === 'unplaced')
  const required = template?.total_visits_required_per_cycle ?? visits.length

  // Crew-day classification.
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

  // Unplaced summary — at most 25 with reasons grouped.
  const unplacedSample = unplaced.slice(0, 25).map((v) => ({
    address:
      v.service_locations?.property?.address_line1 ??
      v.service_locations?.display_name ??
      v.id,
    reason: v.unplaced_reason ?? 'unknown',
  }))

  const systemPrompt = `You are a senior scheduling analyst helping a janitorial bid team refine a cycle's crew schedule. You can READ the cycle's data and SUGGEST changes, but you CANNOT execute them — direct the user to the scheduler UI to apply any move.

Cycle: ${cycle.cycle_number ? `#${cycle.cycle_number}` : cycle.id}
Date range: ${cycle.start_date} → ${cycle.end_date}
Crew count (template): ${template?.crew_count ?? 'unknown'}

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
- For move suggestions, name the property and the target day/crew. Tell the user to use the existing scheduler Move UI to apply it.
- For deeper questions you can't answer with this data, say so plainly.
- Keep responses tight — the user is scanning, not reading.
- If the user asks "what would help?", lead with the highest-leverage change (usually crew imbalance, large unplaced batches, or low pair rate).`

  // ── Call Anthropic ────────────────────────────────────────────────
  const anthropic = new Anthropic({ apiKey })
  try {
    const response = await anthropic.messages.create({
      model: CHAT_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    })
    const text = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
    return res.status(200).json({ message: text, usage: response.usage })
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'Chat failed' })
  }
}
