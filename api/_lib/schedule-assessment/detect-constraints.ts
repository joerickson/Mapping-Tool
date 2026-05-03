// Detect implicit constraints in uploaded schedule data.
//
// v1 detectors:
//
//   dow_avoidance        — across ALL visits, if a day-of-week has 0
//                          occurrences while others are populated and
//                          there are enough total visits to be
//                          confident, suggest "Never on {DOW}".
//
//   workday_cap          — observed maximum buildings/day per crew.
//                          Surfaces as a baseline for the engine's
//                          pairing_max_buildings_per_day setting.
//
//   crew_branch_affinity — if a crew_name's visits cluster geographically
//                          (low spatial spread), suggest a home-branch
//                          assignment for that crew.
//
//   pair_recurring       — two SLs that appear on the same date
//                          repeatedly. Even with N=2 visits per SL per
//                          cycle, "twice in a row, same date" is a
//                          signal.
//
//   dow_per_property     — single property always on the same DOW.
//                          Requires 2+ files (multi-cycle uploads) to
//                          have any confidence; surfaces as informational
//                          on a single file.
import type { SupabaseClient } from '@supabase/supabase-js'

export type DetectionType =
  | 'dow_avoidance'
  | 'workday_cap'
  | 'crew_branch_affinity'
  | 'pair_recurring'
  | 'dow_per_property'

export interface DetectedConstraint {
  detection_type: DetectionType
  scope_type: 'global' | 'crew' | 'property' | 'pair'
  scope_ids: string[] // sl_ids when scope_type=property|pair, empty otherwise
  pattern: Record<string, unknown> // detection-specific payload
  confidence: number // 0..1
}

interface DetectInput {
  assessment_id: string
  // Flag to indicate whether we have multiple historical cycles
  // (file count). Per-property detection is only meaningful with N>=2.
  file_count: number
}

const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export async function detectConstraints(
  db: SupabaseClient,
  input: DetectInput
): Promise<DetectedConstraint[]> {
  // Pull all matched rows with joined property coords (for branch
  // affinity).
  const PAGE = 1000
  const rows: any[] = []
  for (let p = 0; p < 50; p++) {
    const { data } = await db
      .from('schedule_assessment_rows')
      .select('id, matched_service_location_id, raw_scheduled_date, raw_crew_name, file_id, service_locations(property:properties(latitude, longitude))')
      .eq('assessment_id', input.assessment_id)
      .in('match_status', ['auto', 'manual'])
      .not('matched_service_location_id', 'is', null)
      .not('raw_scheduled_date', 'is', null)
      .range(p * PAGE, p * PAGE + PAGE - 1)
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < PAGE) break
  }
  if (rows.length === 0) return []

  const out: DetectedConstraint[] = []

  // ── 1. DOW avoidance ───────────────────────────────────────────
  const dowCounts = [0, 0, 0, 0, 0, 0, 0]
  for (const r of rows) {
    if (!r.raw_scheduled_date) continue
    const d = new Date(`${r.raw_scheduled_date}T00:00:00Z`)
    if (isNaN(d.getTime())) continue
    dowCounts[d.getUTCDay()]++
  }
  const totalDated = dowCounts.reduce((s, n) => s + n, 0)
  if (totalDated >= 20) {
    for (let dow = 0; dow < 7; dow++) {
      if (dowCounts[dow] === 0) {
        // Higher confidence the more total visits we have.
        const confidence = Math.min(0.95, 0.6 + (totalDated - 20) / 200)
        out.push({
          detection_type: 'dow_avoidance',
          scope_type: 'global',
          scope_ids: [],
          pattern: {
            day_of_week: dow,
            day_of_week_name: DOW_NAMES[dow],
            sample_size: totalDated,
          },
          confidence: Math.round(confidence * 100) / 100,
        })
      }
    }
  }

  // ── 2. Workday cap ─────────────────────────────────────────────
  // Count visits per (crew_name, date). Take the 95th percentile.
  const visitsByCrewDate = new Map<string, number>()
  for (const r of rows) {
    if (!r.raw_crew_name || !r.raw_scheduled_date) continue
    const k = `${r.raw_crew_name}|${r.raw_scheduled_date}`
    visitsByCrewDate.set(k, (visitsByCrewDate.get(k) ?? 0) + 1)
  }
  if (visitsByCrewDate.size >= 10) {
    const sorted = Array.from(visitsByCrewDate.values()).sort((a, b) => a - b)
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
    const max = sorted[sorted.length - 1]
    out.push({
      detection_type: 'workday_cap',
      scope_type: 'global',
      scope_ids: [],
      pattern: {
        observed_max: max,
        p95: p95,
        sample_size: sorted.length,
      },
      confidence: Math.min(0.9, 0.5 + sorted.length / 200),
    })
  }

  // ── 3. Crew → branch affinity (geographic centroid + spread) ────
  const byCrewName = new Map<string, Array<{ lat: number; lng: number }>>()
  for (const r of rows) {
    const crew = (r.raw_crew_name ?? '').trim()
    if (!crew) continue
    const lat = r.service_locations?.property?.latitude
    const lng = r.service_locations?.property?.longitude
    if (typeof lat !== 'number' || typeof lng !== 'number') continue
    const arr = byCrewName.get(crew) ?? []
    arr.push({ lat, lng })
    byCrewName.set(crew, arr)
  }
  for (const [crewName, coords] of byCrewName.entries()) {
    if (coords.length < 5) continue
    const centroid = {
      lat: coords.reduce((s, c) => s + c.lat, 0) / coords.length,
      lng: coords.reduce((s, c) => s + c.lng, 0) / coords.length,
    }
    const spreads = coords.map((c) => {
      const dy = (c.lat - centroid.lat) * 69
      const dx = (c.lng - centroid.lng) * 54.6
      return Math.sqrt(dx * dx + dy * dy)
    })
    const meanSpread = spreads.reduce((s, n) => s + n, 0) / spreads.length
    // If a crew's visits cluster within ~50mi of a centroid, that's a
    // strong home-branch signal.
    if (meanSpread < 50) {
      out.push({
        detection_type: 'crew_branch_affinity',
        scope_type: 'crew',
        scope_ids: [],
        pattern: {
          crew_name: crewName,
          centroid_lat: Math.round(centroid.lat * 1000) / 1000,
          centroid_lng: Math.round(centroid.lng * 1000) / 1000,
          mean_spread_miles: Math.round(meanSpread * 10) / 10,
          sample_size: coords.length,
        },
        confidence: Math.max(0.5, Math.min(0.95, 1 - meanSpread / 100)),
      })
    }
  }

  // ── 4. Recurring pairs (two SLs on the same date repeatedly) ────
  // Build (date → sl_ids set), then pair counts.
  const slsByDate = new Map<string, string[]>()
  for (const r of rows) {
    if (!r.raw_scheduled_date) continue
    const arr = slsByDate.get(r.raw_scheduled_date) ?? []
    arr.push(r.matched_service_location_id)
    slsByDate.set(r.raw_scheduled_date, arr)
  }
  const pairCounts = new Map<string, number>()
  for (const sls of slsByDate.values()) {
    const unique = Array.from(new Set(sls))
    if (unique.length < 2) continue
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const k = unique[i] < unique[j] ? `${unique[i]}|${unique[j]}` : `${unique[j]}|${unique[i]}`
        pairCounts.set(k, (pairCounts.get(k) ?? 0) + 1)
      }
    }
  }
  // Pairs that recur more than once are worth surfacing.
  for (const [k, count] of pairCounts) {
    if (count < 2) continue
    const [a, b] = k.split('|')
    out.push({
      detection_type: 'pair_recurring',
      scope_type: 'pair',
      scope_ids: [a, b],
      pattern: { same_date_occurrences: count },
      confidence: count >= 3 ? 0.85 : 0.65,
    })
  }

  // ── 5. Per-property DOW preference (multi-file only) ────────────
  if (input.file_count >= 2) {
    const dowsBySl = new Map<string, number[]>()
    for (const r of rows) {
      if (!r.raw_scheduled_date) continue
      const d = new Date(`${r.raw_scheduled_date}T00:00:00Z`)
      if (isNaN(d.getTime())) continue
      const arr = dowsBySl.get(r.matched_service_location_id) ?? []
      arr.push(d.getUTCDay())
      dowsBySl.set(r.matched_service_location_id, arr)
    }
    for (const [slId, dows] of dowsBySl) {
      if (dows.length < 2) continue
      const counts = [0, 0, 0, 0, 0, 0, 0]
      for (const d of dows) counts[d]++
      const max = Math.max(...counts)
      if (max < 2) continue
      const dominant = counts.indexOf(max)
      const ratio = max / dows.length
      if (ratio >= 0.8) {
        out.push({
          detection_type: 'dow_per_property',
          scope_type: 'property',
          scope_ids: [slId],
          pattern: {
            day_of_week: dominant,
            day_of_week_name: DOW_NAMES[dominant],
            occurrences: max,
            total_visits: dows.length,
          },
          confidence: Math.min(0.9, 0.5 + dows.length * 0.1),
        })
      }
    }
  }

  return out
}
