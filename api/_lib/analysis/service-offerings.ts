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
export async function loadAccountOfferings(
  db: SupabaseClient,
  accountId: string,
  clientId: string
): Promise<Map<string, OfferingRow>> {
  const { data: offerings, error } = await db
    .from('service_offerings')
    .select('id, name, pricing_model, default_visits_per_year, default_hours_per_visit, default_crew_size')
    .or(`account_id.eq.${accountId},client_id.eq.${clientId}`)
  if (error) throw new Error(`service_offerings lookup failed: ${error.message}`)

  const map = new Map<string, OfferingRow>()
  for (const o of (offerings ?? []) as OfferingRow[]) map.set(o.id, o)
  return map
}
