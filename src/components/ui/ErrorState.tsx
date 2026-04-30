// ErrorState — destructive-card variant for inline failure UI.
//
// Pairs with EmptyState semantically. Use when an async section failed
// to load and you want the user to retry. For toasts (transient,
// dismissable), use the toast() API instead.
//
// Layout matches EmptyState — icon + title + description + single CTA —
// so the two render at the same height when one is conditionally swapped
// for the other (e.g. ServiceMixPanel showing EmptyState on no-results
// vs. ErrorState on fetch failure).
import { CircleAlert, type LucideIcon } from 'lucide-react'
import Button from './Button'
import { cn } from '../../lib/cn'

export interface ErrorStateProps {
  icon?: LucideIcon
  title?: React.ReactNode
  /** The error message — typically the caught error's .message. */
  description?: React.ReactNode
  /** Click handler for the retry button. Omit to render no action. */
  onRetry?: () => void
  retryLabel?: string
  className?: string
}

export function ErrorState({
  icon: Icon = CircleAlert,
  title = 'Something went wrong',
  description,
  onRetry,
  retryLabel = 'Try again',
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        // Subtle danger bg + 1px border. Doesn't shout — fits inside a
        // larger Card without dominating.
        'rounded-md border border-danger/20 bg-danger-subtle',
        className
      )}
    >
      <div
        className="flex h-10 w-10 items-center justify-center rounded-md bg-surface text-danger"
        aria-hidden="true"
      >
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-semibold text-fg">{title}</p>
        {description && (
          <p className="text-xs leading-relaxed text-fg-muted">{description}</p>
        )}
      </div>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  )
}
