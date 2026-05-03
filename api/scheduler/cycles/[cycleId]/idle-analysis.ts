// GET /api/scheduler/cycles/[cycleId]/idle-analysis
//
// Per-cycle idle-day analyzer. Identifies workdays where each crew has
// no scheduled work, groups consecutive idle days into streaks, and
// rolls up by home_branch_index so the operator can see at a glance
// which branches have unused capacity and whether it shows up as
// blocks (consider absorbing an overnight trip from elsewhere) or as
// scattered single days (small unpaired buildings).
//
// Reuses computeCrewUtilization() from the scheduler lib for the
// per-day classification — this endpoint adds streak detection +
// per-branch rollup on top.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import { computeCrewUtilization } from '../../../_lib/scheduler/crew-utilization.js'
import { haversineMiles } from '../../../_lib/analysis/haversine.js'

interface IdleStreak {
  start_date: string
  end_date: string
  length: number
}

interface CrewSummary {
  crew_index: number
  crew_label: string
  home_branch_index: number | null
  home_branch_name: string | null
  workdays_total: number
  idle_days: number
  busy_days: number
  utilization_pct: number
  streaks: IdleStreak[]
  longest_streak: number
  pattern: 'blocks' | 'scattered' | 'mixed' | 'none'
}

interface BranchSummary {
  branch_index: number | null
  branch_name: string
  crew_count: number
  workdays_total: number
  idle_days_total: number
  busy_days_total: number
  utilization_pct: number
  streak_count: number
  longest_streak: number
  pattern: 'blocks' | 'scattered' | 'mixed' | 'none'
  crew_indices: number[]
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try { await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const cycleId = req.query.cycleId as string
  const db = createAdminClient()

  // Pull cycle + template (for branches + crew_assignments).
  const { data: cycle, error: cycleErr } = await db
    .from('cycle_instances')
    .select('id, template_id, start_date, end_date')
    .eq('id', cycleId)
    .maybeSingle()
  if (cycleErr) return res.status(500).json({ error: cycleErr.message })
  if (!cycle) return res.status(404).json({ error: 'Cycle not found' })

  const { data: tpl } = await db
    .from('routing_templates')
    .select('crew_count, crew_assignments, branches')
    .eq('id', (cycle as any).template_id)
    .maybeSingle()
  const crewCount = (tpl as any)?.crew_count ?? 1
  const branches = ((tpl as any)?.branches ?? []) as Array<{ name: string; lat: number; lng: number }>
  // Persisted crew_assignments use the crew_-prefixed keys (the engine
  // renames index→crew_index / label→crew_label on emit). Read the
  // prefixed form. home_branch_index has been written since the audit
  // fix — older templates may not have it; we derive from crew_day_routes'
  // start_location below as a defensive fallback.
  const crewAssignments = ((tpl as any)?.crew_assignments ?? []) as Array<{
    crew_index?: number
    crew_label?: string
    home_branch_index?: number
    home_branch_name?: string
  }>

  // Unplaced visits — we use the count to compute "what you'd actually
  // need to cover everything" (the recommended crew count in the
  // calibration block below). One unplaced visit ≈ one crew-day of
  // missing capacity (conservative; some unplaced are partial-day).
  const { count: unplacedCountRaw } = await db
    .from('scheduled_visits')
    .select('id', { count: 'exact', head: true })
    .eq('cycle_instance_id', cycleId)
    .eq('status', 'unplaced')
  const unplacedCount = unplacedCountRaw ?? 0

  // crew_index → home_branch_index. Prefer the template snapshot;
  // for legacy templates (pre-audit) the field may be missing — derive
  // from crew_day_routes start_location matched against branches by
  // haversine distance.
  const homeByCrewIdx = new Map<number, number>()
  for (const ca of crewAssignments) {
    const idx = ca.crew_index
    if (typeof idx === 'number' && typeof ca.home_branch_index === 'number') {
      homeByCrewIdx.set(idx, ca.home_branch_index)
    }
  }

  // Per-day utilization (reuses scheduler's authoritative classifier).
  const days = await computeCrewUtilization(db, cycleId, { include_weekends: false })
  // We only care about workdays here (between_trips, travel, rest, idle,
  // overnight_continuation, fully_utilized are all workday categories).
  const workdays = days.filter((d) => d.is_workday)

  // Defensive fallback (always runs): any crew not already mapped to a
  // home_branch_index, resolve via crew_day_routes start_location →
  // nearest branch by haversine. Then any STILL-unmapped crew (idle
  // crews with zero crew_day_routes rows) anchors to branch 0.
  // This is unconditional because trusting the snapshot alone has
  // burned us — older templates / partial writes / engine bugs have
  // all produced "ghost crews" with no home, which then surface in the
  // UI as "Crew 6" with no branch context.
  if (branches.length > 0) {
    const { data: cdRows } = await db
      .from('crew_day_routes')
      .select('crew_index, start_location')
      .eq('cycle_instance_id', cycleId)
      .not('start_location', 'is', null)
      .limit(crewCount * 5)
    const seen = new Set<number>()
    for (const r of (cdRows ?? []) as any[]) {
      if (seen.has(r.crew_index)) continue
      const sl = r.start_location
      if (!sl || typeof sl.lat !== 'number' || typeof sl.lng !== 'number') continue
      let bestIdx = 0
      let best = Number.POSITIVE_INFINITY
      for (let j = 0; j < branches.length; j++) {
        const d = haversineMiles({ lat: sl.lat, lng: sl.lng }, branches[j])
        if (d < best) { best = d; bestIdx = j }
      }
      if (!homeByCrewIdx.has(r.crew_index)) {
        homeByCrewIdx.set(r.crew_index, bestIdx)
      }
      seen.add(r.crew_index)
    }
    // Final fallback for any still-unmapped crew → branch 0. Without
    // this, idle crews (no crew_day_routes at all) would never get a
    // home and would show as bare "Crew N" in the UI.
    for (let i = 0; i < crewCount; i++) {
      if (!homeByCrewIdx.has(i)) homeByCrewIdx.set(i, 0)
    }
  }

  // Build labels from the now-complete homeByCrewIdx. Sequential per
  // home (Lindon Crew 1, Lindon Crew 2, …) by ascending crew_index for
  // stable numbering across regenerates.
  // Use || (not ??) so empty-string branch names fall through to the
  // "Branch N" placeholder. Also strip leading/trailing whitespace —
  // some legacy branch entries had names like " " that produced labels
  // such as "  Crew 1" (Frisco-style ghost entries).
  const crewLabelByIdx = new Map<number, string>()
  {
    const counter = new Map<number, number>()
    const indices = Array.from(homeByCrewIdx.keys()).sort((a, b) => a - b)
    for (const idx of indices) {
      const home = homeByCrewIdx.get(idx)!
      const rawName = (branches[home]?.name ?? '').trim()
      const branchName = rawName || `Branch ${home + 1}`
      const n = (counter.get(home) ?? 0) + 1
      counter.set(home, n)
      crewLabelByIdx.set(idx, `${branchName} Crew ${n}`)
    }
  }

  // Group by crew index for streak analysis.
  const byCrew = new Map<number, typeof workdays>()
  for (const d of workdays) {
    const arr = byCrew.get(d.crew_index) ?? []
    arr.push(d)
    byCrew.set(d.crew_index, arr)
  }

  // For each crew, sort by date and walk it computing streaks of idle.
  // We treat 'between_trips' and 'idle' as "available capacity" — both
  // are workdays where the crew has no committed work. travel/rest/
  // overnight_continuation are NOT idle (the crew is occupied).
  const crewSummaries: CrewSummary[] = []
  for (let crewIdx = 0; crewIdx < crewCount; crewIdx++) {
    const arr = (byCrew.get(crewIdx) ?? []).slice().sort((a, b) =>
      a.scheduled_date.localeCompare(b.scheduled_date)
    )
    const homeIdx = homeByCrewIdx.get(crewIdx) ?? null
    // Use trimmed-truthy fallback — empty / whitespace-only branch
    // names should resolve to "Branch N", not produce a bare "Crew K".
    const rawHomeName = homeIdx != null ? (branches[homeIdx]?.name ?? '').trim() : ''
    const homeName = homeIdx != null ? (rawHomeName || `Branch ${homeIdx + 1}`) : null

    const streaks: IdleStreak[] = []
    let cur: { start: string; end: string; length: number } | null = null
    let busy = 0
    for (const d of arr) {
      const isIdleish =
        d.state.kind === 'idle' ||
        d.state.kind === 'between_trips'
      if (isIdleish) {
        if (cur) {
          cur.end = d.scheduled_date
          cur.length += 1
        } else {
          cur = { start: d.scheduled_date, end: d.scheduled_date, length: 1 }
        }
      } else {
        busy += 1
        if (cur) {
          streaks.push({ start_date: cur.start, end_date: cur.end, length: cur.length })
          cur = null
        }
      }
    }
    if (cur) streaks.push({ start_date: cur.start, end_date: cur.end, length: cur.length })

    const idle = streaks.reduce((s, x) => s + x.length, 0)
    const total = arr.length
    const longest = streaks.reduce((m, s) => Math.max(m, s.length), 0)
    const avgStreak = streaks.length > 0 ? idle / streaks.length : 0
    let pattern: CrewSummary['pattern'] = 'none'
    if (idle > 0) {
      if (avgStreak >= 3) pattern = 'blocks'
      else if (avgStreak < 1.5) pattern = 'scattered'
      else pattern = 'mixed'
    }

    const homeLabel =
      crewLabelByIdx.get(crewIdx) ??
      (homeName ? `${homeName} Crew ${crewIdx + 1}` : `Crew ${crewIdx + 1}`)
    crewSummaries.push({
      crew_index: crewIdx,
      crew_label: homeLabel,
      home_branch_index: homeIdx,
      home_branch_name: homeName,
      workdays_total: total,
      idle_days: idle,
      busy_days: busy,
      utilization_pct: total > 0 ? Math.round(((total - idle) / total) * 100) : 0,
      streaks,
      longest_streak: longest,
      pattern,
    })
  }

  // Branch rollup.
  const byBranch = new Map<number | null, CrewSummary[]>()
  for (const c of crewSummaries) {
    const key = c.home_branch_index
    const arr = byBranch.get(key) ?? []
    arr.push(c)
    byBranch.set(key, arr)
  }
  const branchSummaries: BranchSummary[] = []
  for (const [branchIdx, crews] of byBranch.entries()) {
    const idleTotal = crews.reduce((s, c) => s + c.idle_days, 0)
    const wkTotal = crews.reduce((s, c) => s + c.workdays_total, 0)
    const busyTotal = wkTotal - idleTotal
    const allStreaks = crews.flatMap((c) => c.streaks)
    const longest = allStreaks.reduce((m, s) => Math.max(m, s.length), 0)
    const avgStreak = allStreaks.length > 0 ? idleTotal / allStreaks.length : 0
    let pattern: BranchSummary['pattern'] = 'none'
    if (idleTotal > 0) {
      if (avgStreak >= 3) pattern = 'blocks'
      else if (avgStreak < 1.5) pattern = 'scattered'
      else pattern = 'mixed'
    }
    branchSummaries.push({
      branch_index: branchIdx,
      branch_name:
        branchIdx != null
          ? (branches[branchIdx]?.name ?? `Branch ${branchIdx}`)
          : 'Unassigned',
      crew_count: crews.length,
      workdays_total: wkTotal,
      idle_days_total: idleTotal,
      busy_days_total: busyTotal,
      utilization_pct: wkTotal > 0 ? Math.round((busyTotal / wkTotal) * 100) : 0,
      streak_count: allStreaks.length,
      longest_streak: longest,
      pattern,
      crew_indices: crews.map((c) => c.crew_index),
    })
  }
  // Branches with the most idle days first — that's where the operator's
  // attention should land.
  branchSummaries.sort((a, b) => b.idle_days_total - a.idle_days_total)

  // Portfolio rollup.
  const portfolio = {
    crew_count: crewSummaries.length,
    workdays_total: crewSummaries.reduce((s, c) => s + c.workdays_total, 0),
    idle_days_total: crewSummaries.reduce((s, c) => s + c.idle_days, 0),
    busy_days_total: 0,
    unplaced_count: unplacedCount,
    utilization_pct: 0,
    longest_streak: crewSummaries.reduce((m, c) => Math.max(m, c.longest_streak), 0),
  }
  portfolio.busy_days_total = portfolio.workdays_total - portfolio.idle_days_total
  portfolio.utilization_pct =
    portfolio.workdays_total > 0
      ? Math.round((portfolio.busy_days_total / portfolio.workdays_total) * 100)
      : 0

  // Calibration: compare the predicted crew count (what Crew Strategy
  // recommended and what the template was built with) against what was
  // actually consumed. Two flavors of recommendation:
  //   effective_crews — minimum crews needed to cover what got placed
  //                     (busy_days / workdays_per_crew). If the predicted
  //                     count is higher, you have wasted capacity.
  //   recommended_crews — minimum crews needed to cover busy + unplaced.
  //                     If the predicted count is lower (or equal), you
  //                     dropped work that more crews could have absorbed.
  const workdaysPerCrew =
    crewSummaries.length > 0
      ? Math.round(
          crewSummaries.reduce((s, c) => s + c.workdays_total, 0) / crewSummaries.length
        )
      : 0
  const effectiveCrews =
    workdaysPerCrew > 0
      ? Math.max(0, Math.ceil(portfolio.busy_days_total / workdaysPerCrew))
      : 0
  const recommendedCrews =
    workdaysPerCrew > 0
      ? Math.max(
          0,
          Math.ceil((portfolio.busy_days_total + unplacedCount) / workdaysPerCrew)
        )
      : 0
  let calibrationVerdict: 'overstaffed' | 'understaffed' | 'balanced'
  if (recommendedCrews > crewCount) calibrationVerdict = 'understaffed'
  else if (effectiveCrews < crewCount) calibrationVerdict = 'overstaffed'
  else calibrationVerdict = 'balanced'
  const calibration = {
    predicted_crews: crewCount,
    effective_crews: effectiveCrews,
    recommended_crews: recommendedCrews,
    workdays_per_crew: workdaysPerCrew,
    busy_days_total: portfolio.busy_days_total,
    unplaced_count: unplacedCount,
    delta_vs_recommended: crewCount - recommendedCrews,
    verdict: calibrationVerdict,
  }

  return res.status(200).json({
    cycle_id: cycleId,
    cycle_start: (cycle as any).start_date,
    cycle_end: (cycle as any).end_date,
    portfolio,
    calibration,
    by_branch: branchSummaries,
    by_crew: crewSummaries,
  })
}
