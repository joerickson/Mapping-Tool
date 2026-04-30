import { X } from 'lucide-react'
import Button from '../ui/Button'

interface BulkSelectMenuProps {
  selectedCount: number
  onAddToPortfolio: () => void
  onExportCsv: () => void
  onReassignClient: () => void
  onClear: () => void
}

export default function BulkSelectMenu({
  selectedCount,
  onAddToPortfolio,
  onExportCsv,
  onReassignClient,
  onClear,
}: BulkSelectMenuProps) {
  if (selectedCount === 0) return null

  return (
    <div
      className={
        'absolute bottom-6 left-1/2 z-10 -translate-x-1/2 ' +
        'inline-flex items-center gap-2 rounded-md border border-border bg-surface-elevated px-4 py-2 ' +
        // Single subtle drop shadow — the only place we use one. The rule is
        // "no shadows on cards"; floating action bars over a busy map need a
        // tiny lift to read against light + dark map tiles.
        'shadow-md'
      }
    >
      <span className="mr-1 text-sm font-medium text-fg">
        <span className="font-tabular">{selectedCount}</span> selected
      </span>
      <Button size="sm" variant="secondary" onClick={onAddToPortfolio}>
        Add to portfolio
      </Button>
      <Button size="sm" variant="secondary" onClick={onExportCsv}>
        Export CSV
      </Button>
      <Button size="sm" variant="secondary" onClick={onReassignClient}>
        Reassign client
      </Button>
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
