// Shared helpers for analysis endpoints: load an account's properties + service
// locations and persist analysis records to portfolio_analyses.
import type { SupabaseClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { resolveClientIds } from '../clients/resolve-client-ids.js'

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
  // Phase 3.9a — manual branch assignment override (branch name).
  // NULL falls back to auto-assigned (nearest branch by haversine).
  branch_override?: string | null
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
  building_size_class_override?: 'small' | 'standard' | 'large' | 'multi_day' | null
  building_size_override_reason?: string | null
}

// Pull every property whose service_locations belong to (account_id, client_id).
// Phase 3.6: clientId is required — analysis is always per-client.
export async function loadAccountProperties(
  db: SupabaseClient,
  accountId: string,
  clientId: string
): Promise<AccountProperty[]> {
  // Step 1: confirm the client belongs to this account
  const { data: clientRow, error: clientErr } = await db
    .from('clients')
    .select('id, is_combined, member_client_ids')
    .eq('id', clientId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (clientErr) throw new Error(`clients lookup failed: ${clientErr.message}`)
  if (!clientRow) return []
  // Combined clients own no SLs of their own — resolve to member ids so
  // every analysis module gets the unioned property set automatically.
  const clientIds: string[] = await resolveClientIds(db, clientId)

  // Step 2: distinct property ids via service_locations. Page — combined
  // clients union member SLs and could exceed the 1000-row PostgREST cap.
  const PAGE = 1000
  const slRows: any[] = []
  for (let p = 0; p < 50; p++) {
    const { data, error: slErr } = await db
      .from('service_locations')
      .select('property_id')
      .in('client_id', clientIds)
      .not('property_id', 'is', null)
      .range(p * PAGE, p * PAGE + PAGE - 1)
    if (slErr) throw new Error(`service_locations lookup failed: ${slErr.message}`)
    const batch = data ?? []
    slRows.push(...batch)
    if (batch.length < PAGE) break
  }
  const propIds = [...new Set(slRows.map((r: any) => r.property_id).filter(Boolean))]
  if (!propIds.length) return []

  // Step 3: properties + their service_locations (chunk + page; combined
  // clients can pull thousands of properties).
  const props: any[] = []
  for (let i = 0; i < propIds.length; i += 250) {
    const chunk = propIds.slice(i, i + 250)
    let pageOffset = 0
    for (let p = 0; p < 50; p++) {
      const { data, error: propErr } = await db
        .from('properties')
        .select(
          'id, address_line1, address_line2, city, state, postal_code, latitude, longitude, geocode_confidence, address_validation_verdict, branch_override, service_locations(id, property_id, client_id, display_name, serviceable_sqft, visits_per_year_override, service_offering_id, status, building_size_class_override, building_size_override_reason)'
        )
        .in('id', chunk)
        .range(pageOffset, pageOffset + PAGE - 1)
      if (propErr) throw new Error(`properties lookup failed: ${propErr.message}`)
      const batch = data ?? []
      props.push(...batch)
      if (batch.length < PAGE) break
      pageOffset += PAGE
    }
  }

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
    branch_override: p.branch_override ?? null,
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

// Fetch the most recent completed analysis row for a given account+client+module.
// Used by chained modules (bid_pricing pulls from crew_strategy etc.).
export async function fetchLatestCompletedAnalysis(
  db: SupabaseClient,
  accountId: string,
  clientId: string,
  moduleKey: string
): Promise<{ id: string; outputs: any; summary_text: string | null } | null> {
  const { data } = await db
    .from('portfolio_analyses')
    .select('id, outputs, summary_text')
    .eq('account_id', accountId)
    .eq('client_id', clientId)
    .eq('module_key', moduleKey)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as any) ?? null
}
