// GET /api/v1/schedule-assessments/[id]/proposed-calendar
//
// Returns the optimized cycle's visits in the same shape as the
// upload calendar (date-keyed, with addresses + serviceable_sqft +
// crew labels). Powers the "Proposed" view of the calendar toggle
// on the assessment detail page.
//
// Source of truth: scheduled_visits for the most recent cycle of
// the assessment's baseline_template_id.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try { await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const id = req.query.id as string
  const db = createAdminClient()

  const { data: assessment } = await db
    .from('schedule_assessments')
    .select('id, baseline_template_id')
    .eq('id', id)
    .maybeSingle()
  if (!assessment) return res.status(404).json({ error: 'Assessment not found' })
  const a = assessment as any
  if (!a.baseline_template_id) {
    return res.status(400).json({
      error: 'No baseline template linked to this assessment.',
      code: 'NO_BASELINE',
    })
  }

  const { data: cycleRow } = await db
    .from('cycle_instances')
    .select('id, start_date, end_date')
    .eq('template_id', a.baseline_template_id)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!cycleRow) {
    return res.status(400).json({ error: 'Linked template has no generated cycle.' })
  }
  const cycleId = (cycleRow as any).id

  // Pull all scheduled visits with SL + property for sqft / address.
  const PAGE = 1000
  type RawVisit = {
    id: string
    scheduled_date: string | null
    crew_index: number | null
    service_location_id: string | null
    service_locations: {
      display_name: string | null
      serviceable_sqft: number | null
      property: {
        address_line1: string | null
        city: string | null
        state: string | null
        postal_code: string | null
        latitude: number | null
        longitude: number | null
      } | null
    } | null
  }
  const visits: RawVisit[] = []
  for (let p = 0; p < 50; p++) {
    const { data } = await db
      .from('scheduled_visits')
      .select(
        'id, scheduled_date, crew_index, service_location_id, ' +
          'service_locations(display_name, serviceable_sqft, property:properties(address_line1, city, state, postal_code, latitude, longitude))'
      )
      .eq('cycle_instance_id', cycleId)
      .not('scheduled_date', 'is', null)
      .range(p * PAGE, p * PAGE + PAGE - 1)
    const arr = (data ?? []) as any[]
    visits.push(...(arr as RawVisit[]))
    if (arr.length < PAGE) break
  }

  // Crew labels — pull canonical names off crew_day_routes.
  const { data: cdRows } = await db
    .from('crew_day_routes')
    .select('crew_index, crew_label')
    .eq('cycle_instance_id', cycleId)
    .limit(500)
  const crewLabelByIdx = new Map<number, string>()
  for (const r of (cdRows ?? []) as any[]) {
    if (typeof r.crew_index === 'number' && !crewLabelByIdx.has(r.crew_index)) {
      crewLabelByIdx.set(r.crew_index, r.crew_label ?? `Crew ${r.crew_index + 1}`)
    }
  }

  type DayVisit = {
    row_id: string
    sl_id: string | null
    display_name: string | null
    address: string | null
    city: string | null
    state: string | null
    postal_code: string | null
    crew_name: string | null
    sqft: number | null
    lat: number | null
    lng: number | null
  }
  type Day = {
    date: string
    dow: string
    visits: DayVisit[]
    total_sqft: number
    visit_count: number
    distinct_crews: number
  }
  const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const byDate = new Map<string, Day>()
  for (const v of visits) {
    if (!v.scheduled_date) continue
    let day = byDate.get(v.scheduled_date)
    if (!day) {
      const dt = new Date(v.scheduled_date + 'T00:00:00Z')
      day = {
        date: v.scheduled_date,
        dow: !Number.isNaN(dt.getTime()) ? dowNames[dt.getUTCDay()] : '?',
        visits: [],
        total_sqft: 0,
        visit_count: 0,
        distinct_crews: 0,
      }
      byDate.set(v.scheduled_date, day)
    }
    const sl = v.service_locations
    const sqft = sl?.serviceable_sqft ?? null
    const crewLabel =
      typeof v.crew_index === 'number'
        ? crewLabelByIdx.get(v.crew_index) ?? `Crew ${v.crew_index + 1}`
        : null
    day.visits.push({
      row_id: v.id,
      sl_id: v.service_location_id,
      display_name: sl?.display_name ?? null,
      address: sl?.property?.address_line1 ?? null,
      city: sl?.property?.city ?? null,
      state: sl?.property?.state ?? null,
      postal_code: sl?.property?.postal_code ?? null,
      crew_name: crewLabel,
      sqft,
      lat: sl?.property?.latitude ?? null,
      lng: sl?.property?.longitude ?? null,
    })
    day.visit_count++
    if (typeof sqft === 'number') day.total_sqft += sqft
  }
  for (const day of byDate.values()) {
    const crews = new Set(
      day.visits.map((v) => (v.crew_name ?? '').trim().toLowerCase()).filter(Boolean)
    )
    day.distinct_crews = crews.size
    day.visits.sort((a, b) => (b.sqft ?? 0) - (a.sqft ?? 0))
  }

  const days = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
  const totalSqft = days.reduce((s, d) => s + d.total_sqft, 0)
  const maxDailySqft = days.reduce((m, d) => Math.max(m, d.total_sqft), 0)
  const maxDailyVisits = days.reduce((m, d) => Math.max(m, d.visit_count), 0)

  return res.status(200).json({
    cycle: {
      id: cycleId,
      start_date: (cycleRow as any).start_date,
      end_date: (cycleRow as any).end_date,
    },
    summary: {
      start_date: days[0]?.date ?? null,
      end_date: days[days.length - 1]?.date ?? null,
      day_count: days.length,
      visit_count: visits.length,
      total_sqft: totalSqft,
      max_daily_sqft: maxDailySqft,
      max_daily_visits: maxDailyVisits,
    },
    days,
  })
}
