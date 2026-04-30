// Audit helper for property + service_location edits. Diffs the old row
// against the patched fields and writes one property_edit_history row per
// changed field.
//
// Used by both PATCH /properties/[id] and PATCH /service-locations/[id]
// so the audit log reads as a single timeline of edits per property.
import type { SupabaseClient } from '@supabase/supabase-js'

export interface AuditScope {
  propertyId: string
  serviceLocationId?: string | null
  accountId?: string | null
  clientId?: string | null
}

export interface AuditOptions {
  changedBy?: string | null
}

// Returns the list of field names that actually changed (after deep equality
// for arrays). Empty array means nothing was logged.
export async function recordEdits(
  db: SupabaseClient,
  scope: AuditScope,
  oldRow: Record<string, unknown>,
  newRow: Record<string, unknown>,
  fieldKeys: string[],
  opts: AuditOptions = {}
): Promise<string[]> {
  const rows: Array<Record<string, unknown>> = []
  const changedKeys: string[] = []

  for (const key of fieldKeys) {
    if (!(key in newRow)) continue
    const oldVal = oldRow[key]
    const newVal = newRow[key]
    if (deepEqual(oldVal, newVal)) continue

    changedKeys.push(key)
    rows.push({
      property_id: scope.propertyId,
      service_location_id: scope.serviceLocationId ?? null,
      account_id: scope.accountId ?? null,
      client_id: scope.clientId ?? null,
      field_name: key,
      old_value: oldVal === undefined ? null : oldVal,
      new_value: newVal === undefined ? null : newVal,
      changed_by: opts.changedBy ?? null,
    })
  }

  if (rows.length === 0) return []

  const { error } = await db.from('property_edit_history').insert(rows)
  if (error) {
    // Audit failures shouldn't break the user's edit — log and move on.
    console.error('property_edit_history insert failed:', error.message)
  }
  return changedKeys
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return a == null && b == null
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
    return true
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a as object)
    const bk = Object.keys(b as object)
    if (ak.length !== bk.length) return false
    for (const k of ak) {
      if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
    }
    return true
  }
  return false
}

// Mark the most recent completed crew_strategy analysis as 'stale' so the
// dashboard prompts a re-run. Called when serviceable_sqft moves >10%.
export async function markCrewStrategyStale(
  db: SupabaseClient,
  accountId: string,
  clientId: string
): Promise<void> {
  const { data: latest } = await db
    .from('portfolio_analyses')
    .select('id')
    .eq('account_id', accountId)
    .eq('client_id', clientId)
    .eq('module_key', 'crew_strategy')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!latest) return
  await db
    .from('portfolio_analyses')
    .update({ status: 'stale' })
    .eq('id', (latest as { id: string }).id)
}
