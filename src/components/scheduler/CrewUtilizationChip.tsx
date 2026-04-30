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

export function stateClass(kind: CrewDayStateKind): string {
  switch (kind) {
    case 'fully_utilized':
      return 'bg-accent/90 text-white border-accent'
    case 'partial':
      return 'bg-accent/40 text-fg border-accent/50'
    case 'idle':
      return 'bg-danger/15 text-danger border-danger/30'
    case 'between_trips':
      return 'bg-fg-subtle/15 text-fg-muted border-fg-subtle/20'
    case 'travel_day':
      return 'bg-warning/30 text-fg border-warning/40'
    case 'rest_day':
      return 'bg-surface-subtle text-fg-muted border-border'
    case 'overnight_continuation':
      return 'bg-accent/70 text-white border-accent'
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
