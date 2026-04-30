// StatusDot — 6px filled circle paired with a label. Used in nav rows,
// table cells, card headers to indicate fresh / stale / running / never.
//
// We pair the dot with text whenever possible; color-only signals fail
// for color-blind users and break the design rules.
import { cn } from '../../lib/cn'

export type StatusVariant =
  | 'fresh'
  | 'stale'
  | 'running'
  | 'never'
  | 'failed'
  | 'idle'

const VARIANT_COLOR: Record<StatusVariant, string> = {
  fresh: 'bg-success',
  stale: 'bg-warning',
  running: 'bg-accent animate-pulse',
  never: 'bg-fg-subtle',
  failed: 'bg-danger',
  idle: 'bg-border-strong',
}

const VARIANT_LABEL: Record<StatusVariant, string> = {
  fresh: 'Fresh',
  stale: 'Stale',
  running: 'Running',
  never: 'Never run',
  failed: 'Failed',
  idle: 'Idle',
}

export function StatusDot({
  variant,
  label,
  size = 'md',
  className,
}: {
  variant: StatusVariant
  label?: React.ReactNode | false
  size?: 'sm' | 'md'
  className?: string
}) {
  const dotSize = size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2'
  const showLabel = label !== false
  const labelText = label === undefined ? VARIANT_LABEL[variant] : label
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span
        aria-hidden="true"
        className={cn('rounded-full shrink-0', dotSize, VARIANT_COLOR[variant])}
      />
      {showLabel && (
        <span className="text-xs text-fg-muted">{labelText}</span>
      )}
    </span>
  )
}
