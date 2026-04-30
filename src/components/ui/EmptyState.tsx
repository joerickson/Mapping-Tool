// EmptyState — used when a list/table has zero items, or when a feature
// is gated and the user needs to know what to do next.
//
// Constraint: ONE primary action. Multi-action empty states (Create + Import
// + Connect) read as decision paralysis; pick the most likely path.
import type { LucideIcon } from 'lucide-react'
import { cn } from '../../lib/cn'

export interface EmptyStateProps {
  icon?: LucideIcon
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center px-6 py-16 gap-3',
        className
      )}
    >
      {Icon && (
        <div
          className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-muted text-fg-muted"
          aria-hidden="true"
        >
          <Icon className="h-6 w-6" strokeWidth={1.75} />
        </div>
      )}
      <div className="space-y-1 max-w-sm">
        <h3 className="text-base font-semibold text-fg">{title}</h3>
        {description && (
          <p className="text-sm text-fg-muted leading-relaxed">{description}</p>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
