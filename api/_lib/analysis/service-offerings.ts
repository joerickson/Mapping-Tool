// Helpers for loading and classifying service offerings. Multiple Phase 2
// modules need to know "is this offering project clean / upholstery /
// recurring janitorial?" to do their math. Centralizing the regex tests here
// keeps the rules consistent and makes them easy to override later.
import type { SupabaseClient } from '@supabase/supabase-js'

export interface OfferingRow {
  id: string
  name: string
  pricing_model: string | null
  default_visits_per_year: number | null
  default_hours_per_visit: number | null
  default_crew_size: number | null
}

export type OfferingClassification =
  | 'project_clean'
  | 'upholstery'
  | 'recurring_janitorial'
  | 'other'

export function classifyOffering(name: string): OfferingClassification {
  // Order matters: upholstery first, then project clean (which catches S&I),
  // then recurring janitorial. Project clean uses a different time formula
  // than the recurring/janitorial work.
  if (/upholstery/i.test(name)) return 'upholstery'
  if (/project\s*clean|S\s*&\s*I\b|strip(?!\w)/i.test(name)) return 'project_clean'
  if (/housekeeping|janitorial|porter|day\s*porter|maintenance/i.test(name))
    return 'recurring_janitorial'
  return 'other'
}

// Whether this offering is school-window-only for seasonality purposes.
// In the Red River methodology, "S&I" (Strip & Initialize) work is the
// canonical school-window service.
export function isSchoolWindowOffering(name: string): boolean {
  return /S\s*&\s*I\b|strip(?!\w)|school/i.test(name)
}

// Workforce B (recurring janitorial / housekeeping) — the workforce sized
// separately from project crews. Per Phase 2 spec, default match is
// /housekeeping|janitorial|S&I/i but excluding project_clean and upholstery.
export function isWorkforceBOffering(name: string): boolean {
  if (/upholstery/i.test(name)) return false
  if (/project\s*clean/i.test(name)) return false
  return /housekeeping|janitorial|S\s*&\s*I\b|porter/i.test(name)
}

// Pull every service_offering visible to (account, client) — the account's
// account-level offerings plus the named client's own offerings.
//
// Combined-client awareness: if clientId points at an is_combined client,
// expand to each member's (account_id, client_id) pair so the analysis
// modules see the unioned offering set. Without this, member SLs whose
// service_offering_id lives in their own account are mis-classified as
// "other" and contribute zero to building-day / hours math — the symptom
// being that combined-client per-branch utilization shows wildly low
// building days for branches whose properties belong to non-host members.
export async function loadAccountOfferings(
  db: SupabaseClient,
  accountId: string,
  clientId: string
): Promise<Map<string, OfferingRow>> {
  // Resolve the client to detect combined.
  const { data: cliRow } = await db
    .from('clients')
    .select('id, account_id, is_combined, member_client_ids')
    .eq('id', clientId)
    .maybeSingle()
  const cli = cliRow as {
    id: string
    account_id: string
    is_combined: boolean | null
    member_client_ids: string[] | null
  } | null

  let orClause: string
  if (cli?.is_combined && Array.isArray(cli.member_client_ids) && cli.member_client_ids.length > 0) {
    // For each member, pull (member.account_id, member.id) so we get the
    // member's account-level + client-level offerings. Also include the
    // host account's account-level offerings so anything defined at that
    // tier still flows through.
    const { data: memberRows } = await db
      .from('clients')
      .select('id, account_id')
      .in('id', cli.member_client_ids)
    const members = (memberRows ?? []) as Array<{ id: string; account_id: string }>
    const memberAccountIds = Array.from(new Set(members.map((m) => m.account_id)))
    const memberClientIds = members.map((m) => m.id)
    const parts: string[] = [
      `account_id.eq.${accountId}`,
      `client_id.eq.${clientId}`,
    ]
    if (memberAccountIds.length > 0) parts.push(`account_id.in.(${memberAccountIds.join(',')})`)
    if (memberClientIds.length > 0) parts.push(`client_id.in.(${memberClientIds.join(',')})`)
    orClause = parts.join(',')
  } else {
    orClause = `account_id.eq.${accountId},client_id.eq.${clientId}`
  }

  const { data: offerings, error } = await db
    .from('service_offerings')
    .select('id, name, pricing_model, default_visits_per_year, default_hours_per_visit, default_crew_size')
    .or(orClause)
  if (error) throw new Error(`service_offerings lookup failed: ${error.message}`)

  const map = new Map<string, OfferingRow>()
  for (const o of (offerings ?? []) as OfferingRow[]) map.set(o.id, o)
  return map
}
