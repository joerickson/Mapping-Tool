// GET /api/v1/schedule-assessments/[id]/calendar
//
// Returns the uploaded schedule organized by date, with each visit's
// service location address + serviceable_sqft attached. The schedule
// assessment UI uses this to render a month-grid calendar so the
// operator can see, at a glance, which days are stacked with large
// buildings vs days with many small ones — the difference between
// "one crew can absorb this" and "we need a second crew."
//
// Output:
//   {
//     summary: {
//       start_date, end_date, day_count, visit_count,
//       total_sqft, max_daily_sqft, max_daily_visits
//     },
//     days: [
//       {
//         date: "2026-04-04",
//         dow: "Mon",
//         visits: [{ row_id, sl_id, display_name, address, crew_name, sqft, lat, lng }],
//         total_sqft, visit_count, distinct_crews
//       }
//     ]
//   }
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
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (!assessment) return res.status(404).json({ error: 'Assessment not found' })

  // Pull all matched rows. Join the SL → property so we can render
  // address + lat/lng, and the SL itself for serviceable_sqft.
  const PAGE = 1000
  type RawRow = {
    id: string
    raw_address: string
    raw_scheduled_date: string | null
    raw_crew_name: string | null
    matched_service_location_id: string | null
    service_locations:
      | {
          id: string
          display_name: string | null
          serviceable_sqft: number | null
          property: {
            address_line1: string | null
            latitude: number | null
            longitude: number | null
          } | null
        }
      | null
  }
  const rows: RawRow[] = []
  for (let p = 0; p < 50; p++) {
    const { data } = await db
      .from('schedule_assessment_rows')
      .select(
        'id, raw_address, raw_scheduled_date, raw_crew_name, matched_service_location_id, ' +
          'service_locations(id, display_name, serviceable_sqft, property:properties(address_line1, latitude, longitude))'
      )
      .eq('assessment_id', id)
      .in('match_status', ['auto', 'manual'])
      .not('matched_service_location_id', 'is', null)
      .not('raw_scheduled_date', 'is', null)
      .range(p * PAGE, p * PAGE + PAGE - 1)
    const arr = (data ?? []) as any[]
    rows.push(...(arr as RawRow[]))
    if (arr.length < PAGE) break
  }

  // Group by date.
  type DayVisit = {
    row_id: string
    sl_id: string | null
    display_name: string | null
    address: string | null
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
  for (const r of rows) {
    const date = r.raw_scheduled_date as string
    let day = byDate.get(date)
    if (!day) {
      const dt = new Date(date + 'T00:00:00Z')
      day = {
        date,
        dow: !Number.isNaN(dt.getTime()) ? dowNames[dt.getUTCDay()] : '?',
        visits: [],
        total_sqft: 0,
        visit_count: 0,
        distinct_crews: 0,
      }
      byDate.set(date, day)
    }
    const sl = r.service_locations
    const sqft = sl?.serviceable_sqft ?? null
    day.visits.push({
      row_id: r.id,
      sl_id: r.matched_service_location_id,
      display_name: sl?.display_name ?? null,
      address: sl?.property?.address_line1 ?? r.raw_address ?? null,
      crew_name: r.raw_crew_name ?? null,
      sqft,
      lat: sl?.property?.latitude ?? null,
      lng: sl?.property?.longitude ?? null,
    })
    day.visit_count++
    if (typeof sqft === 'number') day.total_sqft += sqft
  }
  for (const day of byDate.values()) {
    const crews = new Set(day.visits.map((v) => (v.crew_name ?? '').trim().toLowerCase()).filter(Boolean))
    day.distinct_crews = crews.size
    day.visits.sort((a, b) => (b.sqft ?? 0) - (a.sqft ?? 0))
  }

  const days = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
  const totalSqft = days.reduce((s, d) => s + d.total_sqft, 0)
  const maxDailySqft = days.reduce((m, d) => Math.max(m, d.total_sqft), 0)
  const maxDailyVisits = days.reduce((m, d) => Math.max(m, d.visit_count), 0)

  return res.status(200).json({
    summary: {
      start_date: days[0]?.date ?? null,
      end_date: days[days.length - 1]?.date ?? null,
      day_count: days.length,
      visit_count: rows.length,
      total_sqft: totalSqft,
      max_daily_sqft: maxDailySqft,
      max_daily_visits: maxDailyVisits,
    },
    days,
  })
}
