// Phase 4f — small reusable chip showing a crew-day's state.
// Used in Gantt cells, calendar bars, list rows, map crew status.
import { AlertTriangle, Bed, Plane, Coffee } from 'lucide-react'
import { cn } from '../../lib/cn'

export type CrewDayStateKind =
  | 'fully_utilized'
  | 'partial'
  | 'idle'
  | 'between_trips'
  | 'travel_day'
  | 'rest_day'
  | 'overnight_continuation'

export interface CrewDayState {
  kind: CrewDayStateKind
  work_hours: number
  unused_hours: number
  away_from_branch?: boolean
}

const STATE_LABEL: Record<CrewDayStateKind, string> = {
  fully_utilized: 'Full',
  partial: 'Partial',
  idle: 'Idle',
  between_trips: 'Between',
  travel_day: 'Travel',
  rest_day: 'Rest',
  overnight_continuation: 'Overnight',
}

// Use Tailwind's static palette for these state colors — the
// CSS-var-based theme tokens (bg-accent etc.) don't support the
// `/<opacity>` modifier without channel-formatted vars, and silent
// no-op opacity is what made the Gantt look colorless.
export function stateClass(kind: CrewDayStateKind): string {
  switch (kind) {
    case 'fully_utilized':
      return 'bg-indigo-600 text-white border-indigo-700'
    case 'partial':
      return 'bg-indigo-200 text-indigo-900 border-indigo-300'
    case 'idle':
      return 'bg-red-100 text-red-700 border-red-300'
    case 'between_trips':
      return 'bg-zinc-200 text-zinc-700 border-zinc-300'
    case 'travel_day':
      return 'bg-amber-200 text-amber-900 border-amber-400'
    case 'rest_day':
      return 'bg-zinc-100 text-zinc-600 border-zinc-200'
    case 'overnight_continuation':
      return 'bg-indigo-500 text-white border-indigo-600'
  }
}

export function StateIcon({ kind, className }: { kind: CrewDayStateKind; className?: string }) {
  switch (kind) {
    case 'idle':
    case 'between_trips':
      return <AlertTriangle className={cn('h-3 w-3', className)} />
    case 'overnight_continuation':
      return <Bed className={cn('h-3 w-3', className)} />
    case 'travel_day':
      return <Plane className={cn('h-3 w-3', className)} />
    case 'rest_day':
      return <Coffee className={cn('h-3 w-3', className)} />
    default:
      return null
  }
}

export default function CrewUtilizationChip({
  state,
  utilization_pct,
  size = 'sm',
}: {
  state: CrewDayState
  utilization_pct: number
  size?: 'sm' | 'md'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border font-mono tabular-nums',
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs',
        stateClass(state.kind)
      )}
      title={`${STATE_LABEL[state.kind]} — ${state.work_hours.toFixed(1)}h scheduled`}
    >
      <StateIcon kind={state.kind} />
      {STATE_LABEL[state.kind]}
      {state.kind !== 'idle' && state.kind !== 'between_trips' && state.kind !== 'rest_day' && (
        <span> · {utilization_pct}%</span>
      )}
    </span>
  )
}
