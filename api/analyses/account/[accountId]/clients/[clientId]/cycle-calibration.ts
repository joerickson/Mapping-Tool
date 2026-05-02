// GET /api/analyses/account/[accountId]/clients/[clientId]/cycle-calibration
//
// Multi-cycle calibration. Averages metrics from this client's completed
// cycles to produce a "what the schedule actually does" feedback signal
// for Crew Strategy. Crew Strategy's math assumes 1 building/crew-day
// (or 2 with pairing) — reality may differ because of drive overhead,
// workday windows, etc. This endpoint surfaces the gap and proposes a
// calibrated crew count for the next regen.
//
// Metrics computed:
//   actual_buildings_per_crew_day — total stops placed / busy crew-days
//   actual_pair_rate              — fraction of busy days with ≥ 2 stops
//   actual_drive_overhead_pct     — drive_min / (drive + work) per day
//   actual_unplaced_pct           — unplaced / (placed + unplaced)
//
// Each cycle gets weighted equally (newest first). The endpoint also
// includes a per-cycle breakdown so the UI can show trend.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../../../_lib/supabase.js'
import { authenticateRequest } from '../../../../../_lib/auth.js'

const MAX_CYCLES = 5 // Most recent N cycles inform calibration.

interface CycleMetrics {
  cycle_id: string
  cycle_start: string
  cycle_end: string
  template_id: string
  crew_count: number
  workdays: number
  busy_crew_days: number
  total_stops: number
  paired_days: number
  drive_minutes_total: number
  work_minutes_total: number
  unplaced_count: number
  placed_count: number
  buildings_per_crew_day: number
  pair_rate: number
  drive_overhead_pct: number
  unplaced_pct: number
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try { await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const accountId = req.query.accountId as string
  const clientId = req.query.clientId as string
  const db = createAdminClient()

  // Find this client's completed cycles. Templates can be normal or
  // combined; either way the cycle_instances row carries the template_id
  // and the template carries client_id.
  const { data: tpls } = await db
    .from('routing_templates')
    .select('id, crew_count')
    .eq('account_id', accountId)
    .eq('client_id', clientId)
  const tplIds = ((tpls ?? []) as Array<{ id: string; crew_count: number }>).map((t) => t.id)
  const tplCrewCount = new Map<string, number>(
    ((tpls ?? []) as Array<{ id: string; crew_count: number }>).map((t) => [t.id, t.crew_count])
  )
  if (tplIds.length === 0) {
    return res.status(200).json({ cycles_analyzed: 0, cycles: [], calibration: null })
  }

  const { data: cycleRows } = await db
    .from('cycle_instances')
    .select('id, template_id, start_date, end_date, status, generated_at')
    .in('template_id', tplIds)
    .order('generated_at', { ascending: false })
    .limit(MAX_CYCLES * 2) // pull more, then filter to ones with data

  const cycles = (cycleRows ?? []) as Array<{
    id: string
    template_id: string
    start_date: string
    end_date: string
    status: string
    generated_at: string | null
  }>
  if (cycles.length === 0) {
    return res.status(200).json({ cycles_analyzed: 0, cycles: [], calibration: null })
  }

  const PAGE = 1000
  const perCycle: CycleMetrics[] = []
  for (const c of cycles) {
    if (perCycle.length >= MAX_CYCLES) break

    // Pull crew_day_routes for this cycle.
    const days: any[] = []
    for (let p = 0; p < 50; p++) {
      const { data } = await db
        .from('crew_day_routes')
        .select('crew_index, scheduled_date, total_work_minutes, total_drive_minutes, route, day_type')
        .eq('cycle_instance_id', c.id)
        .range(p * PAGE, (p + 1) * PAGE - 1)
      const batch = data ?? []
      days.push(...batch)
      if (batch.length < PAGE) break
    }
    if (days.length === 0) continue

    // Workdays in cycle (M-F).
    let workdays = 0
    for (
      let d = new Date(c.start_date + 'T00:00:00Z');
      d <= new Date(c.end_date + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      const dow = d.getUTCDay()
      if (dow !== 0 && dow !== 6) workdays++
    }

    // Busy days = days with at least one stop.
    let busyCrewDays = 0
    let totalStops = 0
    let pairedDays = 0
    let driveMin = 0
    let workMin = 0
    for (const d of days) {
      const stops = Array.isArray(d.route) ? d.route.length : 0
      if (stops > 0) busyCrewDays++
      if (stops >= 2) pairedDays++
      totalStops += stops
      driveMin += Number(d.total_drive_minutes ?? 0)
      workMin += Number(d.total_work_minutes ?? 0)
    }

    // Unplaced count for this cycle.
    const { count: unplacedCount } = await db
      .from('scheduled_visits')
      .select('id', { count: 'exact', head: true })
      .eq('cycle_instance_id', c.id)
      .eq('status', 'unplaced')
    const { count: placedCount } = await db
      .from('scheduled_visits')
      .select('id', { count: 'exact', head: true })
      .eq('cycle_instance_id', c.id)
      .neq('status', 'unplaced')

    const unplaced = unplacedCount ?? 0
    const placed = placedCount ?? 0

    perCycle.push({
      cycle_id: c.id,
      cycle_start: c.start_date,
      cycle_end: c.end_date,
      template_id: c.template_id,
      crew_count: tplCrewCount.get(c.template_id) ?? 0,
      workdays,
      busy_crew_days: busyCrewDays,
      total_stops: totalStops,
      paired_days: pairedDays,
      drive_minutes_total: driveMin,
      work_minutes_total: workMin,
      unplaced_count: unplaced,
      placed_count: placed,
      buildings_per_crew_day: busyCrewDays > 0 ? totalStops / busyCrewDays : 0,
      pair_rate: busyCrewDays > 0 ? pairedDays / busyCrewDays : 0,
      drive_overhead_pct:
        driveMin + workMin > 0 ? driveMin / (driveMin + workMin) : 0,
      unplaced_pct: placed + unplaced > 0 ? unplaced / (placed + unplaced) : 0,
    })
  }

  if (perCycle.length === 0) {
    return res.status(200).json({ cycles_analyzed: 0, cycles: [], calibration: null })
  }

  // Equal-weight average across analyzed cycles.
  const avg = (key: keyof CycleMetrics) =>
    perCycle.reduce((s, c) => s + (c[key] as number), 0) / perCycle.length

  const actualBuildingsPerCrewDay = avg('buildings_per_crew_day')
  const actualPairRate = avg('pair_rate')
  const actualDriveOverheadPct = avg('drive_overhead_pct')
  const actualUnplacedPct = avg('unplaced_pct')

  // Calibration factor: how much to scale Crew Strategy's predicted
  // count UP because the engine isn't realizing 1 building/crew-day.
  // E.g. 0.85 buildings/day → factor = 1/0.85 = 1.18 → bump by 18%.
  // Floored at 1.0 — never recommend FEWER crews than the prediction;
  // the calibration card on the Utilization tab handles down-correction
  // per-cycle, this multi-cycle signal is for upward bias when the
  // schedule consistently undershoots.
  const calibrationFactor =
    actualBuildingsPerCrewDay > 0
      ? Math.max(1.0, 1.0 / actualBuildingsPerCrewDay)
      : 1.0

  const verdict: 'accurate' | 'under-predicting' | 'over-predicting' =
    actualUnplacedPct > 0.05 || calibrationFactor > 1.10
      ? 'under-predicting'
      : actualUnplacedPct < 0.01 && actualBuildingsPerCrewDay > 1.05
        ? 'over-predicting'
        : 'accurate'

  return res.status(200).json({
    cycles_analyzed: perCycle.length,
    cycles: perCycle,
    calibration: {
      actual_buildings_per_crew_day: round2(actualBuildingsPerCrewDay),
      actual_pair_rate: round2(actualPairRate),
      actual_drive_overhead_pct: round2(actualDriveOverheadPct),
      actual_unplaced_pct: round2(actualUnplacedPct),
      calibration_factor: round2(calibrationFactor),
      verdict,
    },
  })
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
