// Phase 4f-1 — bottom status bar with cycle summary + save indicator.
import { Check, Loader2, AlertTriangle } from 'lucide-react'
import { cn } from '../../lib/cn'

export type SaveState = 'saved' | 'saving' | 'failed'

interface Props {
  cycleName: string
  startDate: string
  endDate: string
  visitsPlaced: number
  visitsTotal: number
  utilizationPct: number | null
  idleDays: number
  optimizationScore: number | null
  saveState: SaveState
}

export default function StatusBar({
  cycleName,
  startDate,
  endDate,
  visitsPlaced,
  visitsTotal,
  utilizationPct,
  idleDays,
  optimizationScore,
  saveState,
}: Props) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-border bg-surface-elevated px-4 py-1.5 flex items-center gap-4 text-xs text-fg-muted">
      <span className="text-fg font-medium">{cycleName}</span>
      <span className="font-tabular text-fg-subtle">
        {startDate} – {endDate}
      </span>
      <span>
        <span className="font-tabular text-fg">{visitsPlaced}</span> / {visitsTotal} placed
      </span>
      {utilizationPct != null && (
        <span>
          Util: <span className="font-tabular text-fg">{utilizationPct}%</span>
        </span>
      )}
      <span>
        Idle days: <span className="font-tabular text-fg">{idleDays}</span>
      </span>
      {optimizationScore != null && (
        <span>
          Score: <span className="font-tabular text-fg">{optimizationScore}/100</span>
        </span>
      )}
      <span className="ml-auto flex items-center gap-1.5">
        {saveState === 'saved' && (
          <>
            <Check className="h-3 w-3 text-success" />
            <span>All changes saved</span>
          </>
        )}
        {saveState === 'saving' && (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Saving…</span>
          </>
        )}
        {saveState === 'failed' && (
          <>
            <AlertTriangle className="h-3 w-3 text-danger" />
            <span className="text-danger">Save failed</span>
          </>
        )}
      </span>
    </div>
  )
}
