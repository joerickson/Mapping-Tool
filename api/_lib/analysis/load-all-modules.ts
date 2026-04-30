// Loads the latest completed run of every analysis module for an account.
// Returned as a keyed object so consumers can inline `outputs.crew_strategy`
// etc. without doing the lookup themselves.
import type { SupabaseClient } from '@supabase/supabase-js'

export const ALL_MODULE_KEYS = [
  'geographic_distribution',
  'branch_optimization',
  'drive_time_logistics',
  'crew_strategy',
  'workforce_sizing',
  'seasonality_capacity',
  'bid_pricing_structure',
] as const
export type ModuleKey = (typeof ALL_MODULE_KEYS)[number]

export interface ModuleSnapshot {
  id: string
  module_key: ModuleKey
  status: 'completed' | 'failed' | 'running' | 'pending'
  outputs: any
  summary_text: string | null
  property_count: number | null
  completed_at: string | null
}

export type ModuleSnapshots = Partial<Record<ModuleKey, ModuleSnapshot>>

export async function loadLatestModuleSnapshots(
  db: SupabaseClient,
  accountId: string,
  clientId: string
): Promise<ModuleSnapshots> {
  const { data } = await db
    .from('portfolio_analyses')
    .select('id, module_key, status, outputs, summary_text, property_count, completed_at, created_at')
    .eq('account_id', accountId)
    .eq('client_id', clientId)
    .in('module_key', ALL_MODULE_KEYS as unknown as string[])
    .order('created_at', { ascending: false })
    .limit(50)

  const seen = new Set<ModuleKey>()
  const result: ModuleSnapshots = {}
  for (const row of (data ?? []) as any[]) {
    const k = row.module_key as ModuleKey
    if (!ALL_MODULE_KEYS.includes(k)) continue
    if (seen.has(k)) continue
    seen.add(k)
    if (row.status !== 'completed') continue // only surface completed runs
    result[k] = {
      id: row.id,
      module_key: k,
      status: row.status,
      outputs: row.outputs,
      summary_text: row.summary_text,
      property_count: row.property_count,
      completed_at: row.completed_at,
    }
  }
  return result
}
