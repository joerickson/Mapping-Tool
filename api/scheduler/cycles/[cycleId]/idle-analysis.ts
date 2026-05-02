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
  const crewAssignments = ((tpl as any)?.crew_assignments ?? []) as Array<{
    index?: number
    label?: string
    home_branch_index?: number
  }>

  // crew_index → home_branch_index (template snapshot, taken at build time).
  const homeByCrewIdx = new Map<number, number>()
  for (const ca of crewAssignments) {
    const idx = ca.index
    if (typeof idx === 'number' && typeof ca.home_branch_index === 'number') {
      homeByCrewIdx.set(idx, ca.home_branch_index)
    }
  }

  // Per-day utilization (reuses scheduler's authoritative classifier).
  const days = await computeCrewUtilization(db, cycleId, { include_weekends: false })
  // We only care about workdays here (between_trips, travel, rest, idle,
  // overnight_continuation, fully_utilized are all workday categories).
  const workdays = days.filter((d) => d.is_workday)

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
    const homeName = homeIdx != null ? (branches[homeIdx]?.name ?? null) : null

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

    crewSummaries.push({
      crew_index: crewIdx,
      crew_label: arr[0]?.crew_label ?? `Crew ${crewIdx + 1}`,
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
    utilization_pct: 0,
    longest_streak: crewSummaries.reduce((m, c) => Math.max(m, c.longest_streak), 0),
  }
  portfolio.utilization_pct =
    portfolio.workdays_total > 0
      ? Math.round(
          ((portfolio.workdays_total - portfolio.idle_days_total) /
            portfolio.workdays_total) *
            100
        )
      : 0

  return res.status(200).json({
    cycle_id: cycleId,
    cycle_start: (cycle as any).start_date,
    cycle_end: (cycle as any).end_date,
    portfolio,
    by_branch: branchSummaries,
    by_crew: crewSummaries,
  })
}
