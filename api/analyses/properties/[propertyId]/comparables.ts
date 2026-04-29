// GET /api/analyses/properties/[propertyId]/comparables
// Returns the 5–10 properties most similar to this one, scored by:
//   shared service offerings (0.4 max)
//   sqft proximity (0.3 max)
//   same region (0.2)
//   geographic proximity within 100mi (0.1)
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import { haversineMiles, type LatLng } from '../../../_lib/analysis/haversine.js'
import { regionForState } from '../../../_lib/analysis/regions.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const propertyId = req.query.propertyId as string
  const db = createAdminClient()

  // ── Load the subject property + its account context ──────────────────────
  const { data: subject, error: sErr } = await db
    .from('properties')
    .select(
      'id, address_line1, city, state, postal_code, latitude, longitude, service_locations(id, client_id, serviceable_sqft, service_offering_id)'
    )
    .eq('id', propertyId)
    .single()
  if (sErr || !subject) return res.status(404).json({ error: 'Property not found' })

  const subj = subject as any
  const subjectClientIds = [
    ...new Set(
      ((subj.service_locations ?? []) as any[]).map((sl) => sl.client_id).filter(Boolean)
    ),
  ] as string[]

  // Discover the account through the first client
  let accountId: string | null = null
  if (subjectClientIds.length) {
    const { data: client } = await db
      .from('clients')
      .select('account_id')
      .eq('id', subjectClientIds[0])
      .single()
    accountId = (client as any)?.account_id ?? null
  }

  if (!accountId) {
    return res.status(200).json({
      property_id: propertyId,
      property_summary: buildSubjectSummary(subj),
      comparables: [],
      summary_text: 'Cannot find a parent account for this property; comparables disabled.',
    })
  }

  // ── Pull every property under the account's clients ─────────────────────
  const { data: clientRows } = await db
    .from('clients')
    .select('id')
    .eq('account_id', accountId)
  const accountClientIds = (clientRows ?? []).map((c: any) => c.id)
  if (!accountClientIds.length) {
    return res.status(200).json({
      property_id: propertyId,
      property_summary: buildSubjectSummary(subj),
      comparables: [],
      summary_text: 'No other portfolio properties to compare against.',
    })
  }

  const { data: slPropRows } = await db
    .from('service_locations')
    .select('property_id')
    .in('client_id', accountClientIds)
    .not('property_id', 'is', null)
  const candidatePropIds = [
    ...new Set((slPropRows ?? []).map((r: any) => r.property_id).filter(Boolean)),
  ]

  if (!candidatePropIds.length) {
    return res.status(200).json({
      property_id: propertyId,
      property_summary: buildSubjectSummary(subj),
      comparables: [],
      summary_text: 'No comparable properties found in this account.',
    })
  }

  const { data: candidates } = await db
    .from('properties')
    .select(
      'id, address_line1, city, state, postal_code, latitude, longitude, service_locations(id, client_id, serviceable_sqft, service_offering_id)'
    )
    .in('id', candidatePropIds)

  // ── Resolve offering id → name (one query, cached locally) ──────────────
  const allOfferingIds = new Set<string>()
  for (const sl of (subj.service_locations ?? []) as any[]) {
    if (sl.service_offering_id) allOfferingIds.add(sl.service_offering_id)
  }
  for (const c of (candidates ?? []) as any[]) {
    for (const sl of (c.service_locations ?? []) as any[]) {
      if (sl.service_offering_id) allOfferingIds.add(sl.service_offering_id)
    }
  }
  const offeringNameById = new Map<string, string>()
  if (allOfferingIds.size) {
    const { data: oRows } = await db
      .from('service_offerings')
      .select('id, name')
      .in('id', [...allOfferingIds])
    for (const o of (oRows ?? []) as any[]) offeringNameById.set(o.id, o.name)
  }

  // ── Subject metrics ─────────────────────────────────────────────────────
  const subjectSqft = ((subj.service_locations ?? []) as any[]).reduce(
    (s, sl) => s + (sl.serviceable_sqft ?? 0),
    0
  )
  const subjectOfferings = new Set<string>(
    ((subj.service_locations ?? []) as any[])
      .map((sl) => (sl.service_offering_id ? offeringNameById.get(sl.service_offering_id) : null))
      .filter((n): n is string => !!n)
  )
  const subjectRegion = regionForState(subj.state)
  const subjectLatLng: LatLng | null =
    subj.latitude != null && subj.longitude != null
      ? { lat: subj.latitude, lng: subj.longitude }
      : null

  // ── Score each candidate ────────────────────────────────────────────────
  type Comparable = {
    property_id: string
    address: string
    city_state: string
    sqft: number
    service_offerings: string[]
    region: string
    distance_miles: number
    similarity_score: number
    similarity_reasons: string[]
  }
  const scored: Comparable[] = []

  for (const c of (candidates ?? []) as any[]) {
    if (c.id === propertyId) continue

    const cSqft = ((c.service_locations ?? []) as any[]).reduce(
      (s, sl) => s + (sl.serviceable_sqft ?? 0),
      0
    )
    const cOfferings = new Set<string>(
      ((c.service_locations ?? []) as any[])
        .map((sl) =>
          sl.service_offering_id ? offeringNameById.get(sl.service_offering_id) : null
        )
        .filter((n): n is string => !!n)
    )
    const cRegion = regionForState(c.state)
    const cLatLng: LatLng | null =
      c.latitude != null && c.longitude != null ? { lat: c.latitude, lng: c.longitude } : null

    const reasons: string[] = []
    let score = 0

    // Offerings (0.4 max)
    const sharedOfferings = [...cOfferings].filter((o) => subjectOfferings.has(o))
    if (sharedOfferings.length > 0) {
      const offeringScore = Math.min(0.4, 0.2 + 0.1 * sharedOfferings.length)
      score += offeringScore
      reasons.push(
        `same offering${sharedOfferings.length > 1 ? 's' : ''}: ${sharedOfferings.join(', ')}`
      )
    }

    // Sqft proximity (0.3 max)
    if (subjectSqft > 0 && cSqft > 0) {
      const ratio = Math.abs(cSqft - subjectSqft) / subjectSqft
      let sqftScore = 0
      if (ratio <= 0.25) {
        sqftScore = 0.3
        reasons.push(`similar sqft (${Math.round(ratio * 100)}% diff)`)
      } else if (ratio <= 0.5) {
        sqftScore = 0.2
        reasons.push(`similar sqft (${Math.round(ratio * 100)}% diff)`)
      } else if (ratio <= 1.0) {
        sqftScore = 0.1
        reasons.push(`comparable sqft (${Math.round(ratio * 100)}% diff)`)
      }
      score += sqftScore
    }

    // Region (0.2)
    if (cRegion === subjectRegion && subjectRegion !== 'Other') {
      score += 0.2
      reasons.push(`same region (${cRegion})`)
    }

    // Distance (0.1 if within 100mi)
    let distance = Infinity
    if (subjectLatLng && cLatLng) {
      distance = haversineMiles(subjectLatLng, cLatLng)
      if (distance <= 100) {
        score += 0.1
        reasons.push(`within ${Math.round(distance)}mi`)
      }
    }

    if (score < 0.4) continue

    scored.push({
      property_id: c.id,
      address: c.address_line1,
      city_state: `${c.city}, ${c.state}`,
      sqft: cSqft,
      service_offerings: [...cOfferings],
      region: cRegion,
      distance_miles: distance === Infinity ? -1 : Math.round(distance),
      similarity_score: +score.toFixed(2),
      similarity_reasons: reasons,
    })
  }

  scored.sort((a, b) => b.similarity_score - a.similarity_score)
  const top = scored.slice(0, 10)

  return res.status(200).json({
    property_id: propertyId,
    property_summary: buildSubjectSummary(subj, subjectSqft, [...subjectOfferings], subjectRegion),
    comparables: top,
    summary_text:
      top.length === 0
        ? 'No properties scored above the 0.40 similarity threshold.'
        : `${top.length} comparable propert${top.length === 1 ? 'y' : 'ies'} found. Highest similarity: ${top[0].address} (${top[0].similarity_score}).`,
  })
}

function buildSubjectSummary(
  subj: any,
  sqft?: number,
  offerings?: string[],
  region?: string
) {
  const computedSqft =
    sqft ??
    ((subj.service_locations ?? []) as any[]).reduce(
      (s: number, sl: any) => s + (sl.serviceable_sqft ?? 0),
      0
    )
  return {
    address: `${subj.address_line1}, ${subj.city}, ${subj.state}`,
    sqft: computedSqft,
    service_offerings: offerings ?? [],
    region: region ?? regionForState(subj.state),
  }
}
