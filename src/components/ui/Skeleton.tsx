// Skeleton — loading placeholder. Use this instead of spinners for any
// content area that fetches data on mount; spinners read as "broken" when
// the content arrives in chunks.
//
// Animation: opacity pulse rather than the moving-gradient shimmer. The
// shimmer reads as "marketing" when applied to a data tool; the pulse is
// quieter and matches Linear/Vercel's house style.
import { cn } from '../../lib/cn'

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-surface-muted',
        className
      )}
      {...props}
    />
  )
}
