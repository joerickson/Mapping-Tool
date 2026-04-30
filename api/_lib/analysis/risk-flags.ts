// Per-property risk flag computation. Reusable by both the single-property
// endpoint and the bulk-account endpoint.
import type { SupabaseClient } from '@supabase/supabase-js'
import { haversineMiles, driveTimeMinutes, type LatLng } from './haversine.js'

export type RiskSeverity = 'low' | 'medium' | 'high'

export interface RiskFlag {
  type: string
  severity: RiskSeverity
  description: string
}

interface PropertyForRisk {
  id: string
  latitude: number | null
  longitude: number | null
  geocode_confidence: string | null
  address_validation_verdict: string | null
  service_locations: Array<{
    serviceable_sqft: number | null
    service_offering_id: string | null
  }>
}

const SEVERITY_WEIGHT: Record<RiskSeverity, number> = { low: 1, medium: 2, high: 3 }

export interface RiskComputeContext {
  // For drive-time flag
  branches?: Array<{ lat: number; lng: number }>
  drive_speed_mph?: number
  // For isolated flag — set of all portfolio property coordinates
  portfolio_points?: Array<{ id: string; lat: number; lng: number }>
}

export function computeRiskFlags(
  property: PropertyForRisk,
  ctx: RiskComputeContext = {}
): { flags: RiskFlag[]; score: number } {
  const flags: RiskFlag[] = []

  // Long drive (only if branches provided)
  if (
    ctx.branches?.length &&
    property.latitude != null &&
    property.longitude != null
  ) {
    const me: LatLng = { lat: property.latitude, lng: property.longitude }
    let bestDist = Infinity
    for (const b of ctx.branches) {
      const d = haversineMiles(me, b)
      if (d < bestDist) bestDist = d
    }
    const minutes = driveTimeMinutes(bestDist, ctx.drive_speed_mph ?? 60)
    if (minutes > 120) {
      flags.push({
        type: 'long_drive',
        severity: 'high',
        description: `${Math.round(minutes)}-min drive from nearest branch`,
      })
    } else if (minutes > 90) {
      flags.push({
        type: 'long_drive',
        severity: 'medium',
        description: `${Math.round(minutes)}-min drive from nearest branch`,
      })
    }
  }

  // Isolated (no other portfolio property within 50mi)
  if (
    ctx.portfolio_points?.length &&
    property.latitude != null &&
    property.longitude != null
  ) {
    const me: LatLng = { lat: property.latitude, lng: property.longitude }
    let nearestOther = Infinity
    for (const other of ctx.portfolio_points) {
      if (other.id === property.id) continue
      const d = haversineMiles(me, other)
      if (d < nearestOther) nearestOther = d
      if (nearestOther < 50) break
    }
    if (nearestOther > 50 && nearestOther !== Infinity) {
      flags.push({
        type: 'isolated',
        severity: 'medium',
        description: `No other portfolio properties within 50 miles (nearest: ${Math.round(nearestOther)}mi)`,
      })
    }
  }

  // Incomplete data
  const incompleteSlSqft = property.service_locations.some((sl) => !sl.serviceable_sqft)
  const incompleteSlOffering = property.service_locations.some((sl) => !sl.service_offering_id)
  if (property.service_locations.length === 0) {
    flags.push({
      type: 'incomplete_data',
      severity: 'low',
      description: 'No service locations attached to this property',
    })
  } else if (incompleteSlSqft || incompleteSlOffering) {
    const missing: string[] = []
    if (incompleteSlSqft) missing.push('serviceable_sqft')
    if (incompleteSlOffering) missing.push('service_offering_id')
    flags.push({
      type: 'incomplete_data',
      severity: 'low',
      description: `Service location(s) missing: ${missing.join(', ')}`,
    })
  }

  // Geocoding confidence
  if (property.geocode_confidence === 'approximate') {
    flags.push({
      type: 'low_geocode_confidence',
      severity: 'medium',
      description: 'Address geocoded approximately — verify location',
    })
  } else if (property.latitude == null || property.longitude == null) {
    flags.push({
      type: 'no_coordinates',
      severity: 'high',
      description: 'Property has no coordinates — cannot place on map or include in analyses',
    })
  }

  // Address validation
  const v = property.address_validation_verdict
  if (v === 'UNCONFIRMED' || v === 'UNCONFIRMED_BUT_PLAUSIBLE') {
    flags.push({
      type: 'address_unverified',
      severity: 'medium',
      description: `Address validation result: ${v}`,
    })
  }

  const score = flags.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0)
  return { flags, score }
}

// Pull the most recent branch_optimization output's branches at the recommended_k.
// Returns null if no completed run exists.
export async function fetchLatestBranchSet(
  db: SupabaseClient,
  accountId: string,
  clientId: string
): Promise<Array<{ lat: number; lng: number; name: string }> | null> {
  const { data } = await db
    .from('portfolio_analyses')
    .select('outputs')
    .eq('account_id', accountId)
    .eq('client_id', clientId)
    .eq('module_key', 'branch_optimization')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null
  const out = (data as any).outputs as {
    k_results: Array<{
      k: number
      is_elbow: boolean
      branches: Array<{ city_state: string; lat: number; lng: number }>
    }>
    recommended_k: number
  } | null
  if (!out) return null
  const row = out.k_results.find((r) => r.k === out.recommended_k)
  if (!row) return null
  return row.branches.map((b) => ({ name: b.city_state, lat: b.lat, lng: b.lng }))
}

export async function persistRiskFlags(
  db: SupabaseClient,
  propertyId: string,
  flags: RiskFlag[],
  score: number
): Promise<void> {
  const { error } = await db
    .from('properties')
    .update({
      risk_flags: flags,
      risk_score: score,
      risk_assessed_at: new Date().toISOString(),
    })
    .eq('id', propertyId)
  if (error) throw new Error(`risk flag persist failed: ${error.message}`)
}
