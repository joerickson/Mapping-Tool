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
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 bg-white rounded-xl shadow-2xl border px-4 py-3 flex items-center gap-3">
      <span className="text-sm font-medium text-gray-700 mr-2">
        {selectedCount} selected
      </span>
      <Button size="sm" variant="secondary" onClick={onAddToPortfolio}>
        Add to Portfolio
      </Button>
      <Button size="sm" variant="secondary" onClick={onExportCsv}>
        Export CSV
      </Button>
      <Button size="sm" variant="secondary" onClick={onReassignClient}>
        Reassign Client
      </Button>
      <button
        onClick={onClear}
        className="ml-2 text-gray-400 hover:text-gray-600"
        aria-label="Clear selection"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
