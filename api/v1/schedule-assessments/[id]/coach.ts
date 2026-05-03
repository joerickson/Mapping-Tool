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
const MAX_TOKENS = 3000

// Typical commercial-cleaning rule of thumb: a crew can comfortably
// handle ~5-7 small/medium properties in a workday including travel.
// We use 6 as the midpoint to derive an implied baseline crew count
// from daily visit volume when the upload doesn't carry crew names.
const VISITS_PER_CREW_PER_DAY = 6

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

  // Pull ALL rows that have a scheduled date. The previous filter
  // (match_status IN auto/manual) excluded unmatched rows, which made
  // the coach narrate the wrong date envelope when chunks of the
  // upload were "not in portfolio" — e.g. an upload starting in
  // January would appear to start in late May because January's
  // properties weren't yet in the portfolio.
  // For per-property stats (crew/geo) we still need the SL join, so
  // matched rows carry the property; unmatched rows just contribute
  // their date to the daily-volume math.
  const PAGE = 1000
  const rows: Row[] = []
  for (let p = 0; p < 50; p++) {
    const { data } = await db
      .from('schedule_assessment_rows')
      .select(
        'raw_scheduled_date, raw_crew_name, matched_service_location_id, match_status, ' +
          'service_locations(property:properties(latitude, longitude, address_line1))'
      )
      .eq('assessment_id', id)
      .not('raw_scheduled_date', 'is', null)
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
  // Drop rows whose stored date isn't a plausible year. Old parse-csv
  // versions let strings like "1016-05-22" through; those would
  // dominate the min/max envelope.
  const plausibleRows = rows.filter((r) => {
    if (!r.raw_scheduled_date) return false
    const year = Number(r.raw_scheduled_date.slice(0, 4))
    return Number.isFinite(year) && year >= 1900 && year <= 2200
  })
  const implausibleDateCount = rows.length - plausibleRows.length
  if (plausibleRows.length === 0) {
    return res.status(400).json({
      error: 'No rows with plausible scheduled dates yet — upload a schedule first.',
    })
  }
  // Use plausible rows everywhere downstream.
  rows.length = 0
  rows.push(...plausibleRows)
  // Matched-only subset for per-property stats that need the SL join.
  const matchedRows = rows.filter((r) => r.matched_service_location_id && r.property)

  // ---- Current schedule stats ----
  // Date envelope + daily volumes use ALL rows with a date (matched
  // and unmatched). The user uploaded the schedule; the entire date
  // range is the schedule, regardless of which properties are in the
  // portfolio yet.
  const dateValues = rows.map((r) => r.raw_scheduled_date).filter((d): d is string => !!d)
  const startDate = dateValues.length > 0 ? dateValues.reduce((a, b) => (a < b ? a : b)) : null
  const endDate = dateValues.length > 0 ? dateValues.reduce((a, b) => (a > b ? a : b)) : null
  const visitCount = rows.length
  const matchedVisitCount = matchedRows.length
  const distinctProperties = new Set(
    matchedRows.map((r) => r.matched_service_location_id).filter(Boolean)
  ).size

  // Crew breakdown — matched rows only since unmatched rows often
  // share the same Unassigned default and would skew the per-crew
  // counts unhelpfully.
  const byCrew = new Map<string, Row[]>()
  for (const r of matchedRows) {
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

  // Workload per (crew, day) — matched rows only.
  const dayLoad = new Map<string, number>() // "crew|date" → visit count
  for (const r of matchedRows) {
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

  // Visits per workday (across all crews). This is the signal the
  // coach uses to infer how many crews the schedule actually demands
  // when the upload doesn't carry crew names.
  const visitsByDate = new Map<string, number>()
  for (const r of rows) {
    if (!r.raw_scheduled_date) continue
    visitsByDate.set(r.raw_scheduled_date, (visitsByDate.get(r.raw_scheduled_date) ?? 0) + 1)
  }
  const dailyVolumes = Array.from(visitsByDate.entries())
    .map(([date, count]) => {
      const dt = new Date(date + 'T00:00:00Z')
      const dow = !Number.isNaN(dt.getTime())
        ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getUTCDay()]
        : '?'
      return { date, dow, visits: count }
    })
    .sort((a, b) => a.date.localeCompare(b.date))
  const sortedCounts = dailyVolumes.map((d) => d.visits).sort((a, b) => a - b)
  const median = sortedCounts.length > 0 ? sortedCounts[Math.floor(sortedCounts.length / 2)] : 0
  const p75 =
    sortedCounts.length > 0 ? sortedCounts[Math.floor(sortedCounts.length * 0.75)] : 0
  const p90 =
    sortedCounts.length > 0 ? sortedCounts[Math.floor(sortedCounts.length * 0.9)] : 0
  const peak = sortedCounts.length > 0 ? sortedCounts[sortedCounts.length - 1] : 0
  // Implied crew counts at typical and surge volume.
  const baselineCrews = Math.max(1, Math.round(median / VISITS_PER_CREW_PER_DAY))
  const surgeCrews = Math.max(1, Math.ceil(peak / VISITS_PER_CREW_PER_DAY))
  // Surge days = days where volume materially exceeds baseline crew capacity.
  const baselineCapacity = baselineCrews * VISITS_PER_CREW_PER_DAY
  const surgeDays = dailyVolumes
    .filter((d) => d.visits > baselineCapacity)
    .map((d) => ({
      ...d,
      extra_crews_needed: Math.ceil((d.visits - baselineCapacity) / VISITS_PER_CREW_PER_DAY),
    }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 15)

  // Day-of-week distribution.
  const dowCounts = [0, 0, 0, 0, 0, 0, 0]
  for (const d of dateValues) {
    const dt = new Date(d + 'T00:00:00Z')
    if (!Number.isNaN(dt.getTime())) dowCounts[dt.getUTCDay()]++
  }
  const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  // Geographic cohesion: for each (crew, day) with multiple visits,
  // compute the avg pairwise distance. Lower → tighter clustering.
  // Matched rows only (need property coords).
  const clusterMiles: number[] = []
  const cdGroups = new Map<string, Row[]>()
  for (const r of matchedRows) {
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

  // Detect whether crew names were uploaded at all. If every row's
  // "crew" is "Unassigned" / blank, the upload doesn't carry crew
  // assignments — the coach must NOT conclude that crews aren't
  // really assigned in the field.
  const realCrewNames = Array.from(byCrew.keys()).filter(
    (k) => k && k.toLowerCase() !== 'unassigned'
  )
  const crewNamesUploaded = realCrewNames.length > 0
  const workdayCount = dailyVolumes.length

  const stats = {
    current: {
      assessment_name: a.name,
      cycle_start: startDate,
      cycle_end: endDate,
      visit_count: visitCount,
      matched_visit_count: matchedVisitCount,
      unmatched_visit_count: visitCount - matchedVisitCount,
      distinct_properties: distinctProperties,
      workday_count: workdayCount,
      // Crew column status — coach needs to know if it should infer
      // crew count from volume vs trust the column directly.
      crew_names_uploaded: crewNamesUploaded,
      crew_count_in_upload: crewNamesUploaded ? realCrewNames.length : null,
      crew_summary: crewNamesUploaded ? crewSummary.slice(0, 12) : null,
      // Daily volume — the primary signal for "how many crews does
      // this schedule actually demand."
      daily_volume_stats: {
        median_visits_per_workday: median,
        p75_visits_per_workday: p75,
        p90_visits_per_workday: p90,
        peak_visits_per_workday: peak,
        visits_per_crew_per_day_assumption: VISITS_PER_CREW_PER_DAY,
        implied_baseline_crews: baselineCrews,
        implied_surge_crews: surgeCrews,
      },
      // Sample of daily volumes (cap at 60 to keep prompt size sane).
      daily_volumes_sample: dailyVolumes.slice(0, 60),
      surge_days: surgeDays,
      heavy_days: heavyDays.slice(0, 10),
      dow_distribution: dowNames.map((name, i) => ({ day: name, visits: dowCounts[i] })),
      avg_cluster_miles_per_route:
        avgClusterMiles != null ? Math.round(avgClusterMiles * 10) / 10 : null,
    },
    optimized,
  }

  // ---- Coaching narrative ----
  // Pre-format the small set of dates the coach is allowed to cite.
  // We hand these to the model verbatim and tell it any other date
  // string is a hallucination. This is the core anti-hallucination
  // anchor — beats "please don't make up dates" alone.
  const fmtFriendly = (s: string | null): string => {
    if (!s) return '?'
    const dt = new Date(s + 'T00:00:00Z')
    if (Number.isNaN(dt.getTime())) return s
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getUTCDay()]
    const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dt.getUTCMonth()]
    return `${dow}, ${mon} ${dt.getUTCDate()}, ${dt.getUTCFullYear()}`
  }
  const allowedDates: string[] = []
  if (startDate) allowedDates.push(`${startDate} (${fmtFriendly(startDate)}) — schedule start`)
  if (endDate) allowedDates.push(`${endDate} (${fmtFriendly(endDate)}) — schedule end`)
  for (const sd of surgeDays) {
    allowedDates.push(`${sd.date} (${fmtFriendly(sd.date)}) — surge day, ${sd.visits} visits`)
  }
  for (const hd of heavyDays.slice(0, 5)) {
    allowedDates.push(`${hd.date} (${fmtFriendly(hd.date)}) — heavy day, ${hd.visits} visits for ${hd.crew}`)
  }
  if (optimized) {
    allowedDates.push(`${optimized.start_date} (${fmtFriendly(optimized.start_date)}) — optimized cycle start`)
    allowedDates.push(`${optimized.end_date} (${fmtFriendly(optimized.end_date)}) — optimized cycle end`)
  }

  const systemPrompt = buildSystemPrompt()
  const userPrompt =
    `Here are the stats for this client's uploaded schedule${
      optimized ? ' along with the optimized cycle for contrast' : ''
    }.\n\n` +
    `AUTHORITATIVE DATE LIST — these are the ONLY dates you may cite in your narrative. Any other date is a hallucination. Quote them with the friendly format shown:\n` +
    allowedDates.map((d) => `  • ${d}`).join('\n') +
    `\n\nThe schedule covers ${fmtFriendly(startDate)} through ${fmtFriendly(endDate)}. State this date range in your opening sentence and do NOT contradict it.\n\n` +
    `SCHEDULE STATS:\n${JSON.stringify(stats, null, 2)}\n\n` +
    `Write the coaching narrative described in your instructions.`

  const anthropic = new Anthropic({ apiKey })
  let narrative = ''
  try {
    const response = await anthropic.messages.create({
      model: COACH_MODEL,
      max_tokens: MAX_TOKENS,
      // Lower temperature — coaching is fact-anchored. High temp
      // encouraged the model to invent date ranges (e.g. claiming a
      // May–Dec window when the data ran Jan–Dec).
      temperature: 0.2,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })
    const textBlocks = response.content.filter((b: any) => b.type === 'text') as any[]
    narrative = textBlocks.map((b) => b.text).join('\n').trim()
  } catch (err: any) {
    return res.status(500).json({ error: `Coach call failed: ${err?.message ?? 'unknown'}` })
  }

  // Post-flight hallucination check — scan the narrative for ISO
  // dates and call out any that aren't in the allowed list. We don't
  // strip them automatically (false positives would erode trust);
  // we surface the warning alongside the narrative so the operator
  // can decide whether to ignore it or hit "Re-review."
  const allowedIsoDates = new Set<string>()
  if (startDate) allowedIsoDates.add(startDate)
  if (endDate) allowedIsoDates.add(endDate)
  for (const sd of surgeDays) allowedIsoDates.add(sd.date)
  for (const hd of heavyDays) allowedIsoDates.add(hd.date)
  if (optimized) {
    allowedIsoDates.add(optimized.start_date)
    allowedIsoDates.add(optimized.end_date)
  }
  for (const dv of dailyVolumes) allowedIsoDates.add(dv.date)
  const isoMatches = Array.from(narrative.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)).map((m) => m[1])
  const hallucinatedIso = isoMatches.filter((d) => !allowedIsoDates.has(d))

  return res.status(200).json({
    narrative,
    stats,
    hallucinated_dates: Array.from(new Set(hallucinatedIso)),
    generated_at: new Date().toISOString(),
  })
}

function buildSystemPrompt(): string {
  return `You are a scheduling coach for a commercial cleaning operations team. You're reviewing an operator's uploaded schedule like a senior dispatcher mentoring a junior dispatcher — but the dispatcher can't reply, so every point you make has to land on its own.

ANTI-HALLUCINATION — READ FIRST, REREAD BEFORE EACH PARAGRAPH
- The user prompt contains an "AUTHORITATIVE DATE LIST." These are the ONLY dates you may name. Any other date — relative ("the first week of June") or absolute ("around May 4") — is a hallucination. Refuse to invent.
- Numbers (visit counts, sqft, hours, percentages, miles) must come directly from the SCHEDULE STATS payload. Do NOT estimate, round to a "nicer" number, or interpolate. If a stat isn't in the payload, don't cite it.
- The schedule's date range is whatever the user prompt says it is in the "covers X through Y" sentence. State that range in your opening. Never contradict it.
- If you can't make a coaching point with the supplied data, omit it. Do not fill space with invented specifics.
- Crew names are only the ones in \`current.crew_summary\`. Don't invent crew names.
- Properties and addresses are only those that appear in stats. Don't invent buildings.

VOICE
- Warm, direct, specific. Use "you" and "your schedule." Cite real numbers from the stats.
- Coach, don't grade. The optimized cycle is one possible plan among many — never frame the upload as "wrong" because dates differ. Use it only for structural contrast (utilization shape, idle days, total hours).
- Write in flowing prose with short paragraphs. No headings, no "Recommendation 1/2/3", no bulleted lists of actions. Numbered or bulleted lists are OK only when listing specific surge days the operator should look at.
- Do NOT close with a question. There is no chat — questions go nowhere. End with concrete next steps the operator can do TODAY.

CREW COUNT — READ CAREFULLY
The upload may or may not include a crew column.
- If \`current.crew_names_uploaded\` is FALSE: the operator's CSV did not have a crew name field. DO NOT say "your visits are unassigned" or "no crews are assigned." Instead, INFER crew demand from the daily volume. Use \`daily_volume_stats\` and \`surge_days\`.
- If \`current.crew_names_uploaded\` is TRUE: the upload has named crews. Use \`crew_summary\` to talk about specific crews by name and reference workload imbalance.

In either case, lean on the daily-volume math:
- \`implied_baseline_crews\` = how many crews you'd need on a typical day (median volume ÷ ~6 visits/crew/day).
- \`implied_surge_crews\` = how many you'd need on the busiest day.
- \`surge_days\` = the dates that exceed baseline capacity, with how many extra crews each day demands.

Frame this concretely: "You're keeping {baseline} crews busy on a typical day. You have {N} surge days where you need {extra} more crews — those are {dates}. Where are those extra crews coming from? Borrowing from another branch? Overtime? Subbing? If your standing crew count is closer to baseline than peak, your surge plan is the most important thing to nail down."

STRUCTURE (flowing paragraphs, no headings)
1. Open with the schedule's shape: name, date range, total visits, distinct properties, and the implied crew count math (baseline vs surge).
2. What's working — two or three concrete strengths backed by numbers. Examples: tight geo cohesion (low avg_cluster_miles_per_route), even day-of-week distribution, sustained baseline crew utilization, no day exceeding the surge crew count.
3. The surge-day reality — name the worst surge days explicitly with dates and visit counts. Quantify the extra crews needed and prompt the operator to think about where those crews come from. This is the highest-signal coaching most operators need.
4. Other patterns worth a second look — heavy days for individual crews (if crew_summary present), day-of-week imbalance, geographic outliers (high avg_cluster_miles), uneven workdays per crew. Give each observation a number.
5. If optimized stats are present, briefly contrast structurally: does the engine spread the work more evenly? Run more or fewer total hours? Use this to inform what to focus on, not as a verdict.
6. End with 2-4 concrete next steps phrased as actions, NOT questions. Examples: "Audit your {date} surge day and confirm you have a sub crew lined up." "Pull a 4-week travel report on {crew_name} — they're driving {X} miles per day on average vs {Y} for the team." "Run the optimizer with surge crews enabled to see if it can flatten {dates}." Each step should reference a specific number or date from the stats.

RULES
- Be detailed and specific. Aim for 400-600 words. Don't pad — every sentence should reference a real number or date.
- Never end with a question. End with imperative-mood next steps.
- If a stat is missing or null, don't mention it.
- Refuse to make up numbers not in the stats payload.`
}
