// Phase 4b — banner shown above PropertyDetail after an edit triggers
// downstream cascading effects (modules marked stale, synthesis kicked).
//
// Auto-dismisses after 12s, can be closed manually. Click "Re-run modules"
// jumps to the dashboard analysis page so the user can immediately re-run
// the staled modules.
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, X } from 'lucide-react'

const MODULE_LABELS: Record<string, string> = {
  crew_strategy: 'Crew Strategy',
  workforce_sizing: 'Workforce Sizing',
  bid_pricing_structure: 'Bid Pricing',
  branch_optimization: 'Branch Optimization',
  drive_time_logistics: 'Drive Time & Logistics',
  seasonality_capacity: 'Seasonality & Capacity',
  geographic_distribution: 'Geographic Distribution',
}

export interface CascadeInfo {
  analyses_marked_stale: string[]
  synthesis_refresh_triggered: boolean
  comparables_invalidated: boolean
  reasons?: Array<{ field: string; modules: string[]; explanation: string }>
}

interface Props {
  cascade: CascadeInfo | null
  accountId: string
  clientId: string
  onDismiss: () => void
}

export default function CascadeBanner({ cascade, accountId, clientId, onDismiss }: Props) {
  useEffect(() => {
    if (!cascade) return
    const t = setTimeout(onDismiss, 12000)
    return () => clearTimeout(t)
  }, [cascade, onDismiss])

  if (!cascade) return null
  const { analyses_marked_stale, synthesis_refresh_triggered, comparables_invalidated } = cascade
  if (
    analyses_marked_stale.length === 0 &&
    !synthesis_refresh_triggered &&
    !comparables_invalidated
  ) {
    return null
  }

  const moduleNames = analyses_marked_stale
    .map((m) => MODULE_LABELS[m] ?? m)
    .join(', ')

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning/5 px-4 py-3 text-sm"
    >
      <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-fg">
          {moduleNames ? (
            <>
              <span className="font-medium">{moduleNames}</span> marked stale.
            </>
          ) : (
            'Edit propagated to dependent state.'
          )}
          {comparables_invalidated && ' Comparables cache cleared.'}
          {synthesis_refresh_triggered && ' Synthesis re-running in background.'}
        </p>
        {analyses_marked_stale.length > 0 && (
          <Link
            to={`/accounts/${accountId}/clients/${clientId}/analysis`}
            className="text-xs text-accent hover:underline mt-1 inline-block"
          >
            Re-run modules →
          </Link>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="text-fg-subtle hover:text-fg transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
