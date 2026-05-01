// Phase 4f — crew utilization computation.
//
// For each crew × workday in a cycle, classify the day's state. This
// powers the color-coding on every view (Gantt cells, calendar bars,
// map crew status, list state column).
import type { SupabaseClient } from '@supabase/supabase-js'

export type CrewDayStateKind =
  | 'fully_utilized'
  | 'partial'
  | 'idle'
  | 'between_trips'
  | 'travel_day'
  | 'rest_day'
  | 'overnight_continuation'

export interface CrewDayState {
  kind: CrewDayStateKind
  work_hours: number
  unused_hours: number
  // For 'between_trips': info about the surrounding trips.
  last_trip_end?: string
  next_trip_start?: string
  gap_days?: number
  // For 'overnight_continuation': flags away-from-branch.
  away_from_branch?: boolean
}

export interface CrewUtilizationDay {
  crew_index: number
  crew_label: string
  scheduled_date: string // 'YYYY-MM-DD'
  state: CrewDayState
  work_hours_scheduled: number
  work_hours_capacity: number
  utilization_pct: number
  is_workday: boolean
  // Pass-through for UI rendering
  trip_id: string | null
  trip_label: string | null
  trip_day_number: number | null
  trip_total_days: number | null
  day_type: string | null
  // Per-day property labels — what the crew is actually visiting on
  // this day. Phase 4f-4: the cluster (trip_label) alone wasn't useful
  // because users wanted to see which property the crew is on.
  property_count: number
  property_summary: string | null
  property_addresses: string[]
}

interface ComputeOptions {
  include_weekends?: boolean
  workdays_capacity_hours?: number
  between_trips_gap_max_days?: number
}

// Fallback only — actual capacity should come from the routing
// template's config.hours_per_day. The old hardcoded 8 produced a
// utilization that was 25%+ too high when the real config was 10
// (hours_per_day default), because (work_hours / 8) is bigger than
// (work_hours / 10) for the same numerator.
const DEFAULT_CAPACITY_HOURS = 8
const DEFAULT_GAP_MAX_DAYS = 3

export async function computeCrewUtilization(
  db: SupabaseClient,
  cycleInstanceId: string,
  options: ComputeOptions = {}
): Promise<CrewUtilizationDay[]> {
  const includeWeekends = options.include_weekends ?? false
  const gapMax = options.between_trips_gap_max_days ?? DEFAULT_GAP_MAX_DAYS

  const { data: cycle, error: cycleErr } = await db
    .from('cycle_instances')
    .select('id, start_date, end_date, template_id')
    .eq('id', cycleInstanceId)
    .single()
  if (cycleErr || !cycle) throw new Error('Cycle not found')

  const { data: tpl } = await db
    .from('routing_templates')
    .select('crew_count, crew_assignments, config')
    .eq('id', (cycle as any).template_id)
    .single()
  const crewCount = (tpl as any)?.crew_count ?? 1
  // Pull capacity from the routing template's saved config so the
  // utilization denominator matches the day length the template was
  // built against (e.g. 10 hr/day) rather than the legacy hardcoded 8.
  const tplHoursPerDay = Number((tpl as any)?.config?.hours_per_day)
  const capacity =
    options.workdays_capacity_hours ??
    (Number.isFinite(tplHoursPerDay) && tplHoursPerDay > 0
      ? tplHoursPerDay
      : DEFAULT_CAPACITY_HOURS)

  // Page explicitly — PostgREST silently caps a single fetch and large
  // cycles can exceed it (a recent JLL cycle hit exactly 500 returned
  // rows out of 509 expected).
  const ROUTE_PAGE = 1000
  const ROUTE_MAX_PAGES = 50
  const routes: any[] = []
  for (let page = 0; page < ROUTE_MAX_PAGES; page++) {
    const from = page * ROUTE_PAGE
    const to = from + ROUTE_PAGE - 1
    const { data } = await db
      .from('crew_day_routes')
      .select(
        'crew_index, crew_label, scheduled_date, day_type, total_work_minutes, trip_id, trip_label, trip_day_number, trip_total_days, route'
      )
      .eq('cycle_instance_id', cycleInstanceId)
      .range(from, to)
    const batch = data ?? []
    routes.push(...batch)
    if (batch.length < ROUTE_PAGE) break
  }

  // Index routes by (crew_index, scheduled_date) for O(1) lookup.
  const routeByKey = new Map<string, any>()
  for (const r of routes ?? []) {
    const row = r as any
    routeByKey.set(`${row.crew_index}|${row.scheduled_date}`, row)
  }

  // Build the calendar of workdays in the cycle.
  const start = new Date((cycle as any).start_date + 'T00:00:00Z')
  const end = new Date((cycle as any).end_date + 'T00:00:00Z')
  const days: string[] = []
  for (
    let d = new Date(start);
    d <= end;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const dow = d.getUTCDay()
    const isWeekend = dow === 0 || dow === 6
    if (!includeWeekends && isWeekend) continue
    days.push(d.toISOString().slice(0, 10))
  }

  // First pass: classify each (crew, day) without between-trips context.
  const initial: CrewUtilizationDay[] = []
  for (let crewIdx = 0; crewIdx < crewCount; crewIdx++) {
    for (const date of days) {
      const route = routeByKey.get(`${crewIdx}|${date}`)
      if (route) {
        const workHours = (route.total_work_minutes ?? 0) / 60
        const stops = Array.isArray(route.route) ? (route.route as any[]) : []
        // Building-day utilization: a crew can only do one building
        // per day (with small-property pairing as the optimistic
        // ceiling). If the crew has any visits at all that day, the
        // day is "used" — hours-fraction is informational only. The
        // old hours/capacity ratio implied a 6-hour day was 60%
        // utilized when in reality the crew can't go to a second
        // building, so the day is fully consumed.
        const dayIsUsed = stops.length > 0
        const utilPct = dayIsUsed ? 100 : 0
        let kind: CrewDayStateKind
        if (route.day_type === 'travel') {
          kind = 'travel_day'
        } else if (route.day_type === 'rest') {
          kind = 'rest_day'
        } else if (
          route.trip_total_days &&
          route.trip_total_days > 1 &&
          route.trip_day_number != null &&
          route.trip_day_number < route.trip_total_days &&
          route.trip_day_number > 1
        ) {
          // Mid-stretch of a multi-day overnight trip.
          kind = 'overnight_continuation'
        } else if (dayIsUsed) {
          kind = 'fully_utilized'
        } else {
          kind = 'idle'
        }
        const addresses = stops
          .map((s) => (typeof s?.address === 'string' ? s.address.trim() : null))
          .filter((s): s is string => !!s)
        const propertySummary = summarizeAddresses(addresses)
        initial.push({
          crew_index: crewIdx,
          crew_label: route.crew_label ?? `Crew ${crewIdx + 1}`,
          scheduled_date: date,
          state: {
            kind,
            work_hours: workHours,
            unused_hours: Math.max(0, capacity - workHours),
            away_from_branch: kind === 'overnight_continuation',
          },
          work_hours_scheduled: workHours,
          work_hours_capacity: capacity,
          utilization_pct: utilPct,
          is_workday: true,
          trip_id: route.trip_id ?? null,
          trip_label: route.trip_label ?? null,
          trip_day_number: route.trip_day_number ?? null,
          trip_total_days: route.trip_total_days ?? null,
          day_type: route.day_type ?? null,
          property_count: stops.length,
          property_summary: propertySummary,
          property_addresses: addresses,
        })
      } else {
        initial.push({
          crew_index: crewIdx,
          crew_label: `Crew ${crewIdx + 1}`,
          scheduled_date: date,
          state: { kind: 'idle', work_hours: 0, unused_hours: capacity },
          work_hours_scheduled: 0,
          work_hours_capacity: capacity,
          utilization_pct: 0,
          is_workday: true,
          trip_id: null,
          trip_label: null,
          trip_day_number: null,
          trip_total_days: null,
          day_type: null,
          property_count: 0,
          property_summary: null,
          property_addresses: [],
        })
      }
    }
  }

  // Second pass: convert 'idle' to 'between_trips' when surrounded by
  // trips within the gap-max window.
  const byCrew = new Map<number, CrewUtilizationDay[]>()
  for (const d of initial) {
    const arr = byCrew.get(d.crew_index) ?? []
    arr.push(d)
    byCrew.set(d.crew_index, arr)
  }
  for (const arr of byCrew.values()) {
    arr.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
    for (let i = 0; i < arr.length; i++) {
      const day = arr[i]
      if (day.state.kind !== 'idle') continue
      // Look back for the previous workday with work
      let prevWorkIdx = -1
      for (let j = i - 1; j >= Math.max(0, i - gapMax); j--) {
        if (arr[j].state.kind !== 'idle') {
          prevWorkIdx = j
          break
        }
      }
      // Look forward for the next workday with work
      let nextWorkIdx = -1
      for (let j = i + 1; j < Math.min(arr.length, i + 1 + gapMax); j++) {
        if (arr[j].state.kind !== 'idle') {
          nextWorkIdx = j
          break
        }
      }
      if (prevWorkIdx !== -1 && nextWorkIdx !== -1) {
        day.state = {
          kind: 'between_trips',
          work_hours: 0,
          unused_hours: capacity,
          last_trip_end: arr[prevWorkIdx].scheduled_date,
          next_trip_start: arr[nextWorkIdx].scheduled_date,
          gap_days: nextWorkIdx - prevWorkIdx - 1,
        }
      }
    }
  }

  return initial
}

// Build a compact label that fits in a Gantt cell or Calendar tile.
// Strips ", City, State ZIP" so we get the street portion. If multiple
// stops, show the first + "+N more".
function summarizeAddresses(addresses: string[]): string | null {
  if (addresses.length === 0) return null
  const street = (addr: string) => {
    const comma = addr.indexOf(',')
    return (comma > 0 ? addr.slice(0, comma) : addr).trim()
  }
  if (addresses.length === 1) return street(addresses[0])
  const first = street(addresses[0])
  return `${first} +${addresses.length - 1} more`
}
