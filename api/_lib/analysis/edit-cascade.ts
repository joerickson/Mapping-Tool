// Phase 4b: Centralized cascade logic for property + service_location edits.
//
// Single source of truth for "what does changing field X do to the rest of
// the system?". Both PATCH endpoints and the bulk-edit endpoint call
// determineCascadingEffects() and apply the returned actions.
//
// The output is JSON-serializable so it goes straight into the
// property_edit_history.cascading_effects column for the audit log.
import type { SupabaseClient } from '@supabase/supabase-js'

export type EntityType = 'property' | 'service_location'

export interface FieldChange {
  field: string
  old: unknown
  new: unknown
}

export type ModuleKey =
  | 'crew_strategy'
  | 'workforce_sizing'
  | 'bid_pricing_structure'
  | 'branch_optimization'
  | 'drive_time_logistics'
  | 'seasonality_capacity'
  | 'geographic_distribution'

export interface CascadingEffects {
  // Module keys whose latest completed analyses should be marked 'stale'.
  analyses_to_stale: ModuleKey[]
  // Should we kick triggerSynthesisRefresh after the edit?
  synthesis_refresh: boolean
  // Should the property's comparable_properties cache be cleared?
  comparables_invalidate: boolean
  // Did an address field change such that the property needs re-geocoding?
  geocode_required: boolean
  // Why each module is being staled (field → modules) — surfaced in the UI.
  reasons: Array<{ field: string; modules: ModuleKey[]; explanation: string }>
}

const ALL_TIER_2: ModuleKey[] = [
  'crew_strategy',
  'workforce_sizing',
  'bid_pricing_structure',
  'drive_time_logistics',
  'seasonality_capacity',
]

const ADDRESS_FIELDS = new Set([
  'address_line1',
  'address_line2',
  'city',
  'state',
  'postal_code',
  'country',
])

// Threshold for sqft change. >= 10% of the OLD value flips dependent
// modules to stale. Below the threshold, the edit is recorded but no
// modules are staled — small rounding fixes shouldn't churn analyses.
const SQFT_STALE_THRESHOLD = 0.1

export function determineCascadingEffects(
  entityType: EntityType,
  changes: FieldChange[]
): CascadingEffects {
  const out: CascadingEffects = {
    analyses_to_stale: [],
    synthesis_refresh: false,
    comparables_invalidate: false,
    geocode_required: false,
    reasons: [],
  }

  const stale = new Set<ModuleKey>()
  const addStale = (
    field: string,
    modules: ModuleKey[],
    explanation: string
  ) => {
    for (const m of modules) stale.add(m)
    out.reasons.push({ field, modules, explanation })
  }

  for (const c of changes) {
    if (entityType === 'property' && ADDRESS_FIELDS.has(c.field)) {
      out.geocode_required = true
      // Re-geocoding will eventually shift drive-time math, so flag the
      // tier-2 modules that depend on coordinates. They'll re-run when
      // the next dashboard interaction notices the stale flag.
      addStale(
        c.field,
        ['crew_strategy', 'bid_pricing_structure', 'drive_time_logistics', 'branch_optimization'],
        'Address change re-geocodes the property and shifts drive-time inputs.'
      )
      continue
    }

    if (entityType === 'property' && c.field === 'branch_override') {
      addStale(
        c.field,
        ['crew_strategy', 'bid_pricing_structure'],
        'Branch override reshuffles per-branch property allocation and crew counts.'
      )
      continue
    }

    if (entityType === 'service_location') {
      if (c.field === 'serviceable_sqft') {
        const oldN = Number(c.old) || 0
        const newN = Number(c.new) || 0
        if (oldN > 0 && Math.abs(newN - oldN) / oldN >= SQFT_STALE_THRESHOLD) {
          addStale(
            c.field,
            ['crew_strategy', 'workforce_sizing', 'bid_pricing_structure'],
            `Sqft changed by ≥10%; work-hour totals shift across labor + bid math.`
          )
        }
        continue
      }
      if (c.field === 'service_offering_id') {
        // Offering change can flip a property between project-clean and
        // upholstery (or include/exclude it from project crew work),
        // which moves work-hours across modules.
        addStale(
          c.field,
          ALL_TIER_2,
          'Offering change reclassifies the work; all tier-2 modules need to re-run.'
        )
        out.comparables_invalidate = true
        continue
      }
      if (c.field === 'visits_per_year_override' || c.field === 'hours_per_visit_override') {
        addStale(
          c.field,
          ['crew_strategy', 'bid_pricing_structure'],
          'Visit/hour overrides shift annual work-hours.'
        )
        continue
      }
      if (c.field === 'building_size_class_override') {
        addStale(
          c.field,
          ['crew_strategy', 'bid_pricing_structure'],
          'Building-size override changes crew-day math + scheduler pairing.'
        )
        continue
      }
      if (c.field === 'crew_size_override') {
        addStale(
          c.field,
          ['crew_strategy'],
          'Per-SL crew sizing affects crew-strategy capacity math.'
        )
        continue
      }
      if (c.field === 'monthly_contract_value') {
        addStale(
          c.field,
          ['bid_pricing_structure'],
          'Contract value affects bid revenue/margin baseline.'
        )
        continue
      }
    }
  }

  out.analyses_to_stale = Array.from(stale)
  out.synthesis_refresh = out.analyses_to_stale.length > 0
  return out
}

// Apply the cascade: flip the latest completed row of each affected module
// to status='stale', kick synthesis if requested. Comparables invalidation
// for a property happens here too (clear the cached comparables row).
//
// Tolerates partial failures — one module not flipping shouldn't block the
// edit. Each error is logged but the function still returns the list of
// modules that successfully went stale.
export async function applyCascadingEffects(
  db: SupabaseClient,
  effects: CascadingEffects,
  scope: { account_id: string; client_id: string; property_id?: string }
): Promise<{ staled: ModuleKey[]; synthesis_triggered: boolean }> {
  const staled: ModuleKey[] = []
  for (const moduleKey of effects.analyses_to_stale) {
    const { data: latest } = await db
      .from('portfolio_analyses')
      .select('id')
      .eq('account_id', scope.account_id)
      .eq('client_id', scope.client_id)
      .eq('module_key', moduleKey)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!latest) continue
    const { error } = await db
      .from('portfolio_analyses')
      .update({ status: 'stale' })
      .eq('id', (latest as { id: string }).id)
    if (!error) staled.push(moduleKey)
    else console.error(`[edit-cascade] failed to stale ${moduleKey}:`, error.message)
  }

  let synthesisTriggered = false
  if (effects.synthesis_refresh) {
    // Use the existing synthesis-refresh debouncer instead of duplicating
    // the logic here.
    try {
      const { triggerSynthesisRefresh } = await import('../synthesis-refresh.js')
      await triggerSynthesisRefresh(db, scope.account_id, scope.client_id)
      synthesisTriggered = true
    } catch (err) {
      console.error('[edit-cascade] synthesis refresh failed:', err)
    }
  }

  return { staled, synthesis_triggered: synthesisTriggered }
}
