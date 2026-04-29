// Shared helpers for analysis endpoints: load an account's properties + service
// locations and persist analysis records to portfolio_analyses.
import type { SupabaseClient } from '@supabase/supabase-js'
import crypto from 'crypto'

export interface AccountProperty {
  id: string
  address_line1: string
  address_line2: string | null
  city: string
  state: string
  postal_code: string
  latitude: number | null
  longitude: number | null
  geocode_confidence: string | null
  address_validation_verdict: string | null
  service_locations: AccountServiceLocation[]
}

export interface AccountServiceLocation {
  id: string
  property_id: string
  client_id: string | null
  display_name: string | null
  serviceable_sqft: number | null
  visits_per_year_override: number | null
  service_offering_id: string | null
  status: string
}

// Pull every property whose service_locations are owned by a client of this
// account. (clients.account_id → service_locations.client_id → properties.)
export async function loadAccountProperties(
  db: SupabaseClient,
  accountId: string,
  clientId?: string | null
): Promise<AccountProperty[]> {
  // Step 1: client ids for this account (optionally filtered to one)
  let clientQuery = db.from('clients').select('id').eq('account_id', accountId)
  if (clientId) clientQuery = clientQuery.eq('id', clientId)
  const { data: clientRows, error: clientErr } = await clientQuery
  if (clientErr) throw new Error(`clients lookup failed: ${clientErr.message}`)
  const clientIds = (clientRows ?? []).map((c: any) => c.id)
  if (!clientIds.length) return []

  // Step 2: distinct property ids via service_locations
  const { data: slRows, error: slErr } = await db
    .from('service_locations')
    .select('property_id')
    .in('client_id', clientIds)
    .not('property_id', 'is', null)
  if (slErr) throw new Error(`service_locations lookup failed: ${slErr.message}`)
  const propIds = [...new Set((slRows ?? []).map((r: any) => r.property_id).filter(Boolean))]
  if (!propIds.length) return []

  // Step 3: properties + their service_locations (filtered to this account's clients)
  const { data: props, error: propErr } = await db
    .from('properties')
    .select(
      'id, address_line1, address_line2, city, state, postal_code, latitude, longitude, geocode_confidence, address_validation_verdict, service_locations(id, property_id, client_id, display_name, serviceable_sqft, visits_per_year_override, service_offering_id, status)'
    )
    .in('id', propIds)
  if (propErr) throw new Error(`properties lookup failed: ${propErr.message}`)

  return (props ?? []).map((p: any) => ({
    id: p.id,
    address_line1: p.address_line1,
    address_line2: p.address_line2,
    city: p.city,
    state: p.state,
    postal_code: p.postal_code,
    latitude: p.latitude,
    longitude: p.longitude,
    geocode_confidence: p.geocode_confidence,
    address_validation_verdict: p.address_validation_verdict,
    service_locations: (p.service_locations ?? []).filter((sl: any) =>
      clientIds.includes(sl.client_id)
    ),
  }))
}

// Stable hash of analysis inputs for caching (Branch Optimization re-uses this).
export function hashInputs(obj: Record<string, unknown>): string {
  const canonical = JSON.stringify(sortKeys(obj))
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16)
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value as object).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k])
    }
    return out
  }
  return value
}

// Create a new analysis record in 'running' state. Returns the row id.
export async function createAnalysisRecord(
  db: SupabaseClient,
  args: {
    account_id: string
    client_id?: string | null
    module_key: string
    inputs: Record<string, unknown>
    created_by?: string | null
  }
): Promise<string> {
  const { data, error } = await db
    .from('portfolio_analyses')
    .insert({
      account_id: args.account_id,
      client_id: args.client_id ?? null,
      module_key: args.module_key,
      status: 'running',
      inputs: args.inputs,
      created_by: args.created_by ?? null,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`portfolio_analyses insert failed: ${error?.message}`)
  return (data as any).id
}

export async function completeAnalysisRecord(
  db: SupabaseClient,
  id: string,
  args: {
    outputs: unknown
    summary_text: string
    property_count: number
  }
): Promise<void> {
  await db
    .from('portfolio_analyses')
    .update({
      status: 'completed',
      outputs: args.outputs,
      summary_text: args.summary_text,
      property_count: args.property_count,
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)
}

export async function failAnalysisRecord(
  db: SupabaseClient,
  id: string,
  errorMessage: string
): Promise<void> {
  await db
    .from('portfolio_analyses')
    .update({
      status: 'failed',
      error_message: errorMessage.slice(0, 1000),
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)
}
