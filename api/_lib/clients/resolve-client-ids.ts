// Combined-client resolver. A "combined client" is a clients row with
// is_combined=true and member_client_ids set — a virtual portfolio that
// owns no service_locations of its own. Every read path that filters by
// client_id should pass through this helper so a combined client resolves
// to the union of its members.
//
// For a normal client the result is just [clientId], so callers can use
// `.in('client_id', resolved)` unconditionally without branching.
//
// Cache: scoped to the request. We could memoize across requests but
// `clients.is_combined` rarely changes and the table is small.

import type { SupabaseClient } from '@supabase/supabase-js'

export async function resolveClientIds(
  db: SupabaseClient,
  clientId: string
): Promise<string[]> {
  const { data, error } = await db
    .from('clients')
    .select('id, is_combined, member_client_ids')
    .eq('id', clientId)
    .maybeSingle()
  if (error) throw new Error(`resolveClientIds: ${error.message}`)
  if (!data) return [clientId]
  const row = data as {
    id: string
    is_combined: boolean | null
    member_client_ids: string[] | null
  }
  if (row.is_combined && Array.isArray(row.member_client_ids) && row.member_client_ids.length > 0) {
    return row.member_client_ids
  }
  return [clientId]
}

// Variant for an array of input client_ids — expands any combined ids
// into their members and returns a deduped, normal-only id list.
export async function resolveClientIdsList(
  db: SupabaseClient,
  clientIds: string[]
): Promise<string[]> {
  if (clientIds.length === 0) return []
  const { data, error } = await db
    .from('clients')
    .select('id, is_combined, member_client_ids')
    .in('id', clientIds)
  if (error) throw new Error(`resolveClientIdsList: ${error.message}`)
  const out = new Set<string>()
  const seen = new Set<string>()
  for (const r of (data ?? []) as Array<{
    id: string
    is_combined: boolean | null
    member_client_ids: string[] | null
  }>) {
    seen.add(r.id)
    if (r.is_combined && Array.isArray(r.member_client_ids)) {
      for (const m of r.member_client_ids) out.add(m)
    } else {
      out.add(r.id)
    }
  }
  // Pass through any ids that didn't come back from the lookup (treat as
  // unresolved normal ids — caller may have passed a stale/unknown id and
  // we'd rather hand it back than silently drop it).
  for (const id of clientIds) if (!seen.has(id)) out.add(id)
  return Array.from(out)
}
