// POST /api/v1/schedule-assessments/[id]/geocode-match
//
// The lat/lng-based matcher (replaces fuzzy address Jaccard). Steps:
//   1. Pull all rows that aren't already auto-matched.
//   2. For each unique (address, city, state, zip) tuple, geocode
//      via Google. Cached within the request — duplicate addresses
//      across rows hit the API once.
//   3. Pull every SL with coords for the resolved client (members for
//      combined). Build an in-memory list.
//   4. For each row, compute haversine distance to the nearest SL.
//      ≤ 50ft  → auto-match (status='auto', confidence=1.0)
//      ≤ 500ft → near-match (status='pending', operator confirms)
//      > 500ft → not_in_portfolio (no SL matched; user can add)
//   5. Persist results on the row.
//
// Re-runnable: existing matched_status='auto' rows are skipped so
// we don't re-geocode unnecessarily.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import { resolveClientIds } from '../../../_lib/clients/resolve-client-ids.js'
import { geocodeAddress } from '../../../_lib/google-address.js'
import { haversineMiles } from '../../../_lib/analysis/haversine.js'

export const config = { maxDuration: 300 }

const AUTO_MATCH_FT = 50
const NEAR_MATCH_FT = 500
const FT_PER_MILE = 5280

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try { await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const assessmentId = req.query.id as string
  const db = createAdminClient()

  const { data: assessment } = await db
    .from('schedule_assessments')
    .select('id, client_id')
    .eq('id', assessmentId)
    .maybeSingle()
  if (!assessment) return res.status(404).json({ error: 'Assessment not found' })
  const clientId = (assessment as any).client_id as string

  // Pull rows that need geocoding/matching. Skip ones already
  // auto-matched (e.g. via location_code exact-match in upload).
  const PAGE = 1000
  const rows: any[] = []
  for (let p = 0; p < 50; p++) {
    const { data } = await db
      .from('schedule_assessment_rows')
      .select('id, raw_address, raw_city, raw_state, raw_postal_code, raw_location_code, matched_service_location_id, match_status, geocoded_lat, geocoded_lng, geocoded_status')
      .eq('assessment_id', assessmentId)
      .neq('match_status', 'skipped')
      .range(p * PAGE, p * PAGE + PAGE - 1)
    const arr = data ?? []
    rows.push(...arr)
    if (arr.length < PAGE) break
  }
  const targets = rows.filter((r) => r.match_status !== 'auto' || r.matched_service_location_id == null)
  if (targets.length === 0) {
    return res.status(200).json({ ok: true, processed: 0, summary: 'Nothing to do — all rows already matched.' })
  }

  // Pull SLs with coords for matching.
  const memberIds = await resolveClientIds(db, clientId)
  type SlCoord = { id: string; lat: number; lng: number; address: string | null; city: string | null; state: string | null }
  const sls: SlCoord[] = []
  for (let p = 0; p < 50; p++) {
    const { data } = await db
      .from('service_locations')
      .select('id, property:properties(latitude, longitude, address_line1, city, state)')
      .in('client_id', memberIds)
      .range(p * PAGE, p * PAGE + PAGE - 1)
    const batch = data ?? []
    for (const r of batch as any[]) {
      const p2 = r.property
      if (!p2 || typeof p2.latitude !== 'number' || typeof p2.longitude !== 'number') continue
      sls.push({
        id: r.id,
        lat: p2.latitude,
        lng: p2.longitude,
        address: p2.address_line1 ?? null,
        city: p2.city ?? null,
        state: p2.state ?? null,
      })
    }
    if (batch.length < PAGE) break
  }

  // Cache geocode results per unique address tuple within this run.
  const geocodeCache = new Map<string, { lat: number; lng: number; formatted: string; confidence: string } | null>()
  const cacheKey = (r: any) =>
    `${r.raw_address ?? ''}|${r.raw_city ?? ''}|${r.raw_state ?? ''}|${r.raw_postal_code ?? ''}`.toLowerCase()

  // Pre-fill cache from rows already geocoded on a previous run.
  for (const r of targets) {
    if (typeof r.geocoded_lat === 'number' && typeof r.geocoded_lng === 'number') {
      geocodeCache.set(cacheKey(r), {
        lat: r.geocoded_lat,
        lng: r.geocoded_lng,
        formatted: '',
        confidence: '',
      })
    }
  }

  // Process rows in chunks. For each: geocode (if not cached), then
  // find nearest SL.
  type Update = {
    id: string
    geocoded_lat: number | null
    geocoded_lng: number | null
    geocoded_formatted_address: string | null
    geocoded_confidence: string | null
    geocoded_status: string
    matched_service_location_id: string | null
    match_confidence: number | null
    match_distance_feet: number | null
    match_status: string
    match_candidates: any
  }
  const updates: Update[] = []
  let geocoded = 0
  let geocodeFailed = 0
  let autoMatched = 0
  let nearMatched = 0
  let notInPortfolio = 0

  for (const r of targets) {
    const k = cacheKey(r)
    let geo = geocodeCache.get(k)
    let geoStatus: string = 'cached'
    if (!geo && (r.raw_address || r.raw_city || r.raw_postal_code)) {
      try {
        const g = await geocodeAddress({
          address_line1: r.raw_address ?? '',
          city: r.raw_city ?? '',
          state: r.raw_state ?? '',
          postal_code: r.raw_postal_code ?? '',
          country: 'US',
        })
        if (g) {
          geo = {
            lat: g.latitude,
            lng: g.longitude,
            formatted: g.formatted_address,
            confidence: g.confidence,
          }
          geocodeCache.set(k, geo)
          geoStatus = 'ok'
          geocoded++
        } else {
          geocodeCache.set(k, null)
          geoStatus = 'failed'
          geocodeFailed++
        }
      } catch {
        geocodeCache.set(k, null)
        geoStatus = 'failed'
        geocodeFailed++
      }
    } else if (geo) {
      geoStatus = 'cached'
    } else {
      geoStatus = 'failed'
      geocodeFailed++
    }

    if (!geo) {
      updates.push({
        id: r.id,
        geocoded_lat: null,
        geocoded_lng: null,
        geocoded_formatted_address: null,
        geocoded_confidence: null,
        geocoded_status: geoStatus,
        matched_service_location_id: null,
        match_confidence: null,
        match_distance_feet: null,
        match_status: 'unmatched',
        match_candidates: null,
      })
      continue
    }

    // Find nearest SL.
    let bestIdx = -1
    let bestMiles = Number.POSITIVE_INFINITY
    for (let i = 0; i < sls.length; i++) {
      const d = haversineMiles({ lat: geo.lat, lng: geo.lng }, sls[i])
      if (d < bestMiles) {
        bestMiles = d
        bestIdx = i
      }
    }
    const distFeet = bestIdx >= 0 ? bestMiles * FT_PER_MILE : Number.POSITIVE_INFINITY
    const best = bestIdx >= 0 ? sls[bestIdx] : null

    let matchStatus: string
    let confidence: number | null = null
    let candidatesPayload: any = null
    if (best && distFeet <= AUTO_MATCH_FT) {
      matchStatus = 'auto'
      confidence = 1.0
      autoMatched++
    } else if (best && distFeet <= NEAR_MATCH_FT) {
      matchStatus = 'pending'
      // Confidence proportional to closeness (50ft → 0.95, 500ft → 0.5).
      const t = Math.max(0, Math.min(1, (NEAR_MATCH_FT - distFeet) / (NEAR_MATCH_FT - AUTO_MATCH_FT)))
      confidence = 0.5 + t * 0.45
      nearMatched++
      // Top 3 nearest as candidates.
      const top = sls
        .map((s) => ({ s, miles: haversineMiles({ lat: geo!.lat, lng: geo!.lng }, s) }))
        .sort((a, b) => a.miles - b.miles)
        .slice(0, 3)
      candidatesPayload = top.map((t) => ({
        sl_id: t.s.id,
        address_line1: t.s.address ?? '',
        score: Math.round((1 - Math.min(1, t.miles)) * 100) / 100,
        distance_feet: Math.round(t.miles * FT_PER_MILE),
      }))
    } else {
      matchStatus = 'unmatched'
      notInPortfolio++
    }

    updates.push({
      id: r.id,
      geocoded_lat: geo.lat,
      geocoded_lng: geo.lng,
      geocoded_formatted_address: geo.formatted ?? null,
      geocoded_confidence: geo.confidence ?? null,
      geocoded_status: geoStatus,
      matched_service_location_id: matchStatus === 'auto' || matchStatus === 'pending' ? best?.id ?? null : null,
      match_confidence: confidence,
      match_distance_feet: Number.isFinite(distFeet) ? Math.round(distFeet) : null,
      match_status: matchStatus,
      match_candidates: candidatesPayload,
    })
  }

  // Persist in chunks.
  for (let i = 0; i < updates.length; i += 200) {
    const chunk = updates.slice(i, i + 200)
    const { error } = await db
      .from('schedule_assessment_rows')
      .upsert(chunk, { onConflict: 'id' })
    if (error) {
      // eslint-disable-next-line no-console
      console.warn(`geocode-match update batch failed: ${error.message}`)
    }
  }

  await db
    .from('schedule_assessments')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', assessmentId)

  return res.status(200).json({
    ok: true,
    processed: targets.length,
    geocoded,
    geocode_failed: geocodeFailed,
    auto_matched: autoMatched,
    near_matched: nearMatched,
    not_in_portfolio: notInPortfolio,
  })
}
