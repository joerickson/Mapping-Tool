// GET /api/analyses/properties/[propertyId]/service-mix
// Looks at service offerings present at comparable properties (same client +
// region) and recommends offerings this property is missing. Confidence is
// driven by what fraction of comparables have each offering.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
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

  // Subject property (client + region matter for the comparable cohort)
  const { data: subject, error: sErr } = await db
    .from('properties')
    .select(
      'id, state, service_locations(client_id, service_offering_id, serviceable_sqft)'
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
  const subjectRegion = regionForState(subj.state)

  if (!subjectClientIds.length) {
    return res.status(200).json({
      property_id: propertyId,
      current_offerings: [],
      recommended_additions: [],
      summary_text: 'No client linkage found; service-mix recommendations disabled.',
    })
  }

  // Cohort: same client(s), same region
  const { data: slPropRows } = await db
    .from('service_locations')
    .select('property_id')
    .in('client_id', subjectClientIds)
    .not('property_id', 'is', null)
  const cohortPropIds = [
    ...new Set((slPropRows ?? []).map((r: any) => r.property_id).filter(Boolean)),
  ]
  if (!cohortPropIds.length) {
    return res.status(200).json({
      property_id: propertyId,
      current_offerings: [],
      recommended_additions: [],
      summary_text: 'No cohort properties found.',
    })
  }

  const { data: cohort } = await db
    .from('properties')
    .select('id, state, service_locations(service_offering_id, serviceable_sqft)')
    .in('id', cohortPropIds)

  // Restrict cohort to same region as subject (drop "Other" — too broad)
  const sameRegionCohort = ((cohort ?? []) as any[]).filter((p) => {
    const r = regionForState(p.state)
    return r === subjectRegion && r !== 'Other'
  })
  const usableCohort = sameRegionCohort.length >= 5 ? sameRegionCohort : (cohort ?? []) as any[]
  const peers = usableCohort.filter((p) => p.id !== propertyId)

  if (peers.length === 0) {
    return res.status(200).json({
      property_id: propertyId,
      current_offerings: [],
      recommended_additions: [],
      summary_text: 'No peer properties found in the same region or client.',
    })
  }

  // Tally offering presence across peers
  const offeringPresence = new Map<string, { count: number; sqftSamples: number[] }>()
  for (const p of peers) {
    const seen = new Set<string>()
    for (const sl of (p.service_locations ?? []) as any[]) {
      if (!sl.service_offering_id || seen.has(sl.service_offering_id)) continue
      seen.add(sl.service_offering_id)
      const cur = offeringPresence.get(sl.service_offering_id) ?? {
        count: 0,
        sqftSamples: [],
      }
      cur.count += 1
      if (sl.serviceable_sqft) cur.sqftSamples.push(sl.serviceable_sqft)
      offeringPresence.set(sl.service_offering_id, cur)
    }
  }

  // Subject's current offerings
  const currentOfferingIds = new Set<string>(
    ((subj.service_locations ?? []) as any[])
      .map((sl) => sl.service_offering_id)
      .filter(Boolean)
  )

  // Resolve names
  const allOfferingIds = new Set<string>([
    ...currentOfferingIds,
    ...offeringPresence.keys(),
  ])
  const nameById = new Map<string, string>()
  if (allOfferingIds.size) {
    const { data: oRows } = await db
      .from('service_offerings')
      .select('id, name')
      .in('id', [...allOfferingIds])
    for (const o of (oRows ?? []) as any[]) nameById.set(o.id, o.name)
  }

  const currentNames = [...currentOfferingIds]
    .map((id) => nameById.get(id))
    .filter((n): n is string => !!n)

  // Find offerings present at >50% of peers that this property doesn't have
  const recs: Array<{
    offering_name: string
    rationale: string
    confidence: 'high' | 'medium' | 'low'
    estimated_value: string
  }> = []

  for (const [offeringId, info] of offeringPresence.entries()) {
    if (currentOfferingIds.has(offeringId)) continue
    const pct = info.count / peers.length
    if (pct < 0.3) continue

    const offeringName = nameById.get(offeringId) ?? 'Unknown offering'
    let confidence: 'high' | 'medium' | 'low'
    if (pct > 0.75) confidence = 'high'
    else if (pct >= 0.5) confidence = 'medium'
    else confidence = 'low'

    // Ballpark $/year using a simple sqft heuristic from peer averages.
    const avgSqft =
      info.sqftSamples.length > 0
        ? info.sqftSamples.reduce((a, b) => a + b, 0) / info.sqftSamples.length
        : 0
    const lowEstimate = Math.round((avgSqft * 0.4) / 100) * 100
    const highEstimate = Math.round((avgSqft * 0.6) / 100) * 100
    const estimated_value =
      avgSqft > 0
        ? `~$${lowEstimate.toLocaleString()}–$${highEstimate.toLocaleString()}/year`
        : 'Quote on request'

    recs.push({
      offering_name: offeringName,
      rationale: `${Math.round(pct * 100)}% of comparable properties in this ${
        usableCohort === sameRegionCohort ? 'region' : 'client portfolio'
      } have this offering`,
      confidence,
      estimated_value,
    })
  }

  recs.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 } as const
    return order[a.confidence] - order[b.confidence]
  })

  const summaryParts: string[] = []
  if (recs.length === 0) {
    summaryParts.push(
      'No additional offerings recommended — current service mix matches comparable properties.'
    )
  } else {
    const top = recs[0]
    summaryParts.push(
      `${recs.length} potential addition${recs.length === 1 ? '' : 's'}: ${recs
        .slice(0, 3)
        .map((r) => r.offering_name)
        .join(', ')}${recs.length > 3 ? ' and more' : ''}.`
    )
    summaryParts.push(
      `Strongest signal: ${top.offering_name} (${top.confidence} confidence).`
    )
  }
  summaryParts.push(
    `Cohort: ${peers.length} peer propert${peers.length === 1 ? 'y' : 'ies'}${
      usableCohort === sameRegionCohort ? ` in ${subjectRegion}` : ' across the client'
    }.`
  )

  return res.status(200).json({
    property_id: propertyId,
    current_offerings: currentNames,
    cohort_size: peers.length,
    cohort_scope: usableCohort === sameRegionCohort ? 'region' : 'client',
    recommended_additions: recs,
    summary_text: summaryParts.join(' '),
  })
}
