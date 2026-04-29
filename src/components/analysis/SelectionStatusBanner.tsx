import { useState } from 'react'
import Button from '../ui/Button'
import type { SelectedBranch } from './BuildSelectionModal'

interface Props {
  branches: SelectedBranch[]
  selectedAt: string | null
  selectedFromAnalysisId: string | null
  onChangeSelection: () => Promise<void>
}

export default function SelectionStatusBanner({
  branches,
  selectedAt,
  selectedFromAnalysisId,
  onChangeSelection,
}: Props) {
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState(false)

  const handleChange = async () => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setWorking(true)
    try {
      await onChangeSelection()
    } finally {
      setWorking(false)
      setConfirming(false)
    }
  }

  return (
    <div className="bg-gradient-to-r from-emerald-50 to-green-50 border border-emerald-200 rounded-xl px-5 py-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-emerald-700 text-base font-semibold">✓ Branch Selection Locked</span>
            <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">
              K = {branches.length}
            </span>
          </div>
          <div className="mt-1 text-sm text-gray-700 break-words">
            {branches.map((b) => preferCityState(b)).join(' · ')}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            {selectedAt && (
              <>
                Selected {relativeTime(selectedAt)}
                {selectedFromAnalysisId && (
                  <>
                    {' from Branch Optimization run '}
                    <span className="font-mono">{selectedFromAnalysisId.slice(0, 8)}</span>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {confirming && (
            <span className="text-xs text-gray-600">
              This will clear your selection. Tier 2 analyses will need to be re-run after re-selecting.
            </span>
          )}
          <Button
            variant={confirming ? 'danger' : 'secondary'}
            size="sm"
            onClick={handleChange}
            loading={working}
            disabled={working}
          >
            {confirming ? 'Confirm clear' : 'Change selection'}
          </Button>
          {confirming && !working && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(false)}
              disabled={working}
            >
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// Show "City, ST" when the SelectedBranch carries it; fall back to the
// user-supplied name only when city_state is empty. Catches the case where
// a branch was confirmed before the city_state field existed or the user
// named a branch with raw coordinates.
function preferCityState(b: { name: string; city_state?: string }): string {
  if (b.city_state && b.city_state.trim() && !looksLikeCoords(b.city_state)) return b.city_state
  if (b.name && !looksLikeCoords(b.name)) return b.name
  return b.city_state || b.name || '(unnamed)'
}

function looksLikeCoords(s: string): boolean {
  // "32.881, -96.823" or "32.881,-96.823" — two numbers separated by comma
  return /^-?\d+\.\d+\s*,\s*-?\d+\.\d+$/.test(s.trim())
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 'just now'
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hr ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`
  return `${Math.floor(day / 30)} mo ago`
}
