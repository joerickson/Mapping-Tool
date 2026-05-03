// POST /api/v1/schedule-assessments/[id]/coach
//
// Generates a coaching narrative about the operator's uploaded schedule.
// Unlike the rigid "current vs optimized" diff, this endpoint evaluates
// the schedule on its own merits (what's working, what to consider) and
// only references the optimized cycle for contrast — date-by-date match
// rate is misleading because the optimized cycle is on a future window
// that doesn't share dates with the upload.
//
// Output: { narrative: string, stats: {...} }
//
// The stats block is what we hand to Claude — current-schedule
// utilization, idle days, day-of-week consistency, geo cluster quality
// — plus optimized-cycle stats for contrast. Narrative is one or two
// paragraphs of coaching prose: what the schedule does well, what to
// consider, no rigid recommendations.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import { computeCrewUtilization } from '../../../_lib/scheduler/crew-utilization.js'
import { haversineMiles } from '../../../_lib/analysis/haversine.js'

export const config = { maxDuration: 60 }

const COACH_MODEL = 'claude-sonnet-4-5'
const MAX_TOKENS = 1500

type Row = {
  raw_scheduled_date: string | null
  raw_crew_name: string | null
  matched_service_location_id: string | null
  property: { latitude: number | null; longitude: number | null; address_line1: string | null } | null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try { await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' })

  const id = req.query.id as string
  const db = createAdminClient()

  const { data: assessment } = await db
    .from('schedule_assessments')
    .select('id, name, baseline_template_id')
    .eq('id', id)
    .maybeSingle()
  if (!assessment) return res.status(404).json({ error: 'Assessment not found' })
  const a = assessment as any

  // Pull all matched rows + property coords.
  const PAGE = 1000
  const rows: Row[] = []
  for (let p = 0; p < 50; p++) {
    const { data } = await db
      .from('schedule_assessment_rows')
      .select(
        'raw_scheduled_date, raw_crew_name, matched_service_location_id, ' +
          'service_locations(property:properties(latitude, longitude, address_line1))'
      )
      .eq('assessment_id', id)
      .in('match_status', ['auto', 'manual'])
      .not('matched_service_location_id', 'is', null)
      .range(p * PAGE, p * PAGE + PAGE - 1)
    const arr = (data ?? []) as any[]
    for (const r of arr) {
      rows.push({
        raw_scheduled_date: r.raw_scheduled_date ?? null,
        raw_crew_name: r.raw_crew_name ?? null,
        matched_service_location_id: r.matched_service_location_id ?? null,
        property: r.service_locations?.property
          ? {
              latitude: r.service_locations.property.latitude,
              longitude: r.service_locations.property.longitude,
              address_line1: r.service_locations.property.address_line1,
            }
          : null,
      })
    }
    if (arr.length < PAGE) break
  }
  if (rows.length === 0) {
    return res.status(400).json({
      error: 'No matched rows yet — finish geocoding/matching before asking for coaching.',
    })
  }

  // ---- Current schedule stats ----
  const dateValues = rows.map((r) => r.raw_scheduled_date).filter((d): d is string => !!d)
  const startDate = dateValues.length > 0 ? dateValues.reduce((a, b) => (a < b ? a : b)) : null
  const endDate = dateValues.length > 0 ? dateValues.reduce((a, b) => (a > b ? a : b)) : null
  const visitCount = rows.length
  const distinctProperties = new Set(rows.map((r) => r.matched_service_location_id)).size

  // Crew breakdown.
  const byCrew = new Map<string, Row[]>()
  for (const r of rows) {
    const k = (r.raw_crew_name ?? 'Unassigned').trim() || 'Unassigned'
    const arr = byCrew.get(k) ?? []
    arr.push(r)
    byCrew.set(k, arr)
  }
  const crewSummary = Array.from(byCrew.entries())
    .map(([crew, rs]) => {
      const days = new Set(rs.map((r) => r.raw_scheduled_date).filter(Boolean))
      return { crew, visits: rs.length, work_days: days.size }
    })
    .sort((a, b) => b.visits - a.visits)

  // Workload per (crew, day).
  const dayLoad = new Map<string, number>() // "crew|date" → visit count
  for (const r of rows) {
    if (!r.raw_scheduled_date) continue
    const k = `${r.raw_crew_name ?? 'Unassigned'}|${r.raw_scheduled_date}`
    dayLoad.set(k, (dayLoad.get(k) ?? 0) + 1)
  }
  const heavyDays: Array<{ crew: string; date: string; visits: number }> = []
  for (const [k, v] of dayLoad.entries()) {
    if (v >= 3) {
      const [crew, date] = k.split('|')
      heavyDays.push({ crew, date, visits: v })
    }
  }
  heavyDays.sort((a, b) => b.visits - a.visits)

  // Day-of-week distribution.
  const dowCounts = [0, 0, 0, 0, 0, 0, 0]
  for (const d of dateValues) {
    const dt = new Date(d + 'T00:00:00Z')
    if (!Number.isNaN(dt.getTime())) dowCounts[dt.getUTCDay()]++
  }
  const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  // Geographic cohesion: for each (crew, day) with multiple visits,
  // compute the avg pairwise distance. Lower → tighter clustering.
  const clusterMiles: number[] = []
  const cdGroups = new Map<string, Row[]>()
  for (const r of rows) {
    if (!r.raw_scheduled_date) continue
    const k = `${r.raw_crew_name ?? 'Unassigned'}|${r.raw_scheduled_date}`
    const arr = cdGroups.get(k) ?? []
    arr.push(r)
    cdGroups.set(k, arr)
  }
  for (const [, arr] of cdGroups) {
    const coords = arr
      .map((r) => r.property)
      .filter(
        (p): p is { latitude: number; longitude: number; address_line1: string | null } =>
          !!p && typeof p.latitude === 'number' && typeof p.longitude === 'number'
      )
    if (coords.length < 2) continue
    let sum = 0
    let n = 0
    for (let i = 0; i < coords.length; i++) {
      for (let j = i + 1; j < coords.length; j++) {
        sum += haversineMiles(
          { lat: coords[i].latitude, lng: coords[i].longitude },
          { lat: coords[j].latitude, lng: coords[j].longitude }
        )
        n++
      }
    }
    if (n > 0) clusterMiles.push(sum / n)
  }
  const avgClusterMiles =
    clusterMiles.length > 0
      ? clusterMiles.reduce((a, b) => a + b, 0) / clusterMiles.length
      : null

  // ---- Optimized cycle stats (for contrast only) ----
  let optimized: {
    start_date: string
    end_date: string
    utilization_pct: number
    total_hours: number
    workday_count: number
    idle_days: number
  } | null = null
  if (a.baseline_template_id) {
    const { data: cycleRow } = await db
      .from('cycle_instances')
      .select('id, start_date, end_date')
      .eq('template_id', a.baseline_template_id)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (cycleRow) {
      try {
        const utilDays = await computeCrewUtilization(db, (cycleRow as any).id)
        let totalHours = 0
        let used = 0
        let idle = 0
        for (const d of utilDays) {
          totalHours += d.work_hours_scheduled
          if (d.utilization_pct > 0) used++
          if (d.state.kind === 'idle') idle++
        }
        optimized = {
          start_date: (cycleRow as any).start_date,
          end_date: (cycleRow as any).end_date,
          utilization_pct: utilDays.length > 0 ? Math.round((used / utilDays.length) * 100) : 0,
          total_hours: Math.round(totalHours * 10) / 10,
          workday_count: utilDays.length,
          idle_days: idle,
        }
      } catch {
        // best-effort
      }
    }
  }

  const stats = {
    current: {
      assessment_name: a.name,
      cycle_start: startDate,
      cycle_end: endDate,
      visit_count: visitCount,
      distinct_properties: distinctProperties,
      crew_count: byCrew.size,
      crew_summary: crewSummary.slice(0, 12),
      heavy_days: heavyDays.slice(0, 10),
      dow_distribution: dowNames.map((name, i) => ({ day: name, visits: dowCounts[i] })),
      avg_cluster_miles_per_route: avgClusterMiles != null ? Math.round(avgClusterMiles * 10) / 10 : null,
    },
    optimized,
  }

  // ---- Coaching narrative ----
  const systemPrompt = buildSystemPrompt()
  const userPrompt = `Here are the stats for this client's uploaded schedule${
    optimized ? ' along with the optimized cycle for contrast' : ''
  }. Write the coaching narrative described in your instructions.\n\nSCHEDULE STATS:\n${JSON.stringify(stats, null, 2)}`

  const anthropic = new Anthropic({ apiKey })
  let narrative = ''
  try {
    const response = await anthropic.messages.create({
      model: COACH_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })
    const textBlocks = response.content.filter((b: any) => b.type === 'text') as any[]
    narrative = textBlocks.map((b) => b.text).join('\n').trim()
  } catch (err: any) {
    return res.status(500).json({ error: `Coach call failed: ${err?.message ?? 'unknown'}` })
  }

  return res.status(200).json({
    narrative,
    stats,
    generated_at: new Date().toISOString(),
  })
}

function buildSystemPrompt(): string {
  return `You are a scheduling coach for a commercial cleaning operations team. Your job is to read the operator's uploaded schedule and give them coaching feedback — like a senior dispatcher reviewing a junior dispatcher's plan.

VOICE
- Warm, direct, specific. Use "you" and "your schedule." Cite real numbers from the stats.
- Coach, don't grade. The schedule isn't being scored against the engine; the engine is one possible plan among many. The operator's plan may be perfectly fine — your job is to surface what's working and what's worth a second look.
- Avoid robotic phrases like "Recommendation 1:" or "Action item:". Write in flowing sentences and short paragraphs.
- Do NOT compare the upload's dates to the optimized cycle's dates — they're on different windows. The optimized cycle is for contrast on overall structure (utilization, idle-day patterns, total hours), not date-by-date alignment.

STRUCTURE (no headings, just flowing paragraphs)
1. Open with one or two sentences naming the schedule and what it covers (date range, visit count, crew count).
2. What's working well — point to two or three concrete things from the data. Examples: tight geographic clustering (avg_cluster_miles_per_route is low), balanced crew workload (crew_summary visits/work_days are similar across crews), consistent day-of-week patterns (dow_distribution is even), no obviously over-loaded days.
3. What to consider — two or three things worth a closer look, framed as questions or observations, not orders. Examples: a crew working far more days than others, days with 4+ visits per crew (heavy_days — is that realistic?), uneven day-of-week loading, big avg cluster mileage suggesting routes could be tightened.
4. If optimized stats are present, briefly contrast at a high level — does the engine suggest a more even utilization? More idle days? Use this to inform the "what to consider" section, not as a verdict.
5. Close with an open question that invites the operator to think.

RULES
- Do not list "5 things to fix." Pick the two or three most signal-rich observations and dwell on them.
- Don't recommend rigid actions ("move 6 visits from Mon to Thu"). Coach the operator's thinking.
- If a stat is missing or null, don't mention it.
- Keep it under 250 words.`
}
