// POST /api/analyses/properties/[propertyId]/risk-flags
// Synchronous: computes flags for a single property and writes them to
// properties.risk_flags / .risk_score / .risk_assessed_at. Returns the result.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import {
  computeRiskFlags,
  fetchLatestBranchSet,
  persistRiskFlags,
} from '../../../_lib/analysis/risk-flags.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const propertyId = req.query.propertyId as string
  const db = createAdminClient()

  // Load property + service_locations + figure out account via service_locations.client_id
  const { data: property, error: pErr } = await db
    .from('properties')
    .select(
      'id, latitude, longitude, geocode_confidence, address_validation_verdict, service_locations(serviceable_sqft, service_offering_id, client_id)'
    )
    .eq('id', propertyId)
    .single()

  if (pErr || !property) return res.status(404).json({ error: 'Property not found' })

  const sls = ((property as any).service_locations ?? []) as Array<{
    serviceable_sqft: number | null
    service_offering_id: string | null
    client_id: string | null
  }>

  // Resolve account_id via the first service_location's client_id (best effort).
  // This lets us pull this account's branch set + isolation context.
  let accountId: string | null = null
  let portfolioPoints: Array<{ id: string; lat: number; lng: number }> | undefined
  let branches: Array<{ lat: number; lng: number }> | undefined

  const firstClientId = sls.find((sl) => sl.client_id)?.client_id ?? null
  if (firstClientId) {
    const { data: client } = await db
      .from('clients')
      .select('account_id')
      .eq('id', firstClientId)
      .single()
    accountId = (client as any)?.account_id ?? null
  }

  if (accountId) {
    const branchSet = await fetchLatestBranchSet(db, accountId)
    if (branchSet) branches = branchSet.map((b) => ({ lat: b.lat, lng: b.lng }))

    // Build portfolio points for isolation check
    const { data: clientRows } = await db
      .from('clients')
      .select('id')
      .eq('account_id', accountId)
    const clientIds = (clientRows ?? []).map((c: any) => c.id)
    if (clientIds.length) {
      const { data: slPropRows } = await db
        .from('service_locations')
        .select('property_id')
        .in('client_id', clientIds)
        .not('property_id', 'is', null)
      const propIds = [...new Set((slPropRows ?? []).map((r: any) => r.property_id))]
      if (propIds.length) {
        const { data: portfolioRows } = await db
          .from('properties')
          .select('id, latitude, longitude')
          .in('id', propIds)
          .not('latitude', 'is', null)
          .not('longitude', 'is', null)
        portfolioPoints = (portfolioRows ?? []).map((p: any) => ({
          id: p.id,
          lat: p.latitude,
          lng: p.longitude,
        }))
      }
    }
  }

  const { flags, score } = computeRiskFlags(
    {
      id: (property as any).id,
      latitude: (property as any).latitude,
      longitude: (property as any).longitude,
      geocode_confidence: (property as any).geocode_confidence,
      address_validation_verdict: (property as any).address_validation_verdict,
      service_locations: sls,
    },
    { branches, portfolio_points: portfolioPoints }
  )

  await persistRiskFlags(db, propertyId, flags, score)

  return res.status(200).json({
    property_id: propertyId,
    risk_flags: flags,
    risk_score: score,
    risk_assessed_at: new Date().toISOString(),
  })
}
