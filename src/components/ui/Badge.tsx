// Badge — small status pill. "Subtle" style only (light bg, dark text) per
// design rules; avoid solid color blocks.
import { forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'

const badgeVariants = cva(
  [
    'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5',
    'text-xs font-medium leading-none whitespace-nowrap',
  ],
  {
    variants: {
      variant: {
        default: 'bg-surface-muted text-fg-muted',
        accent: 'bg-accent-subtle text-accent',
        success: 'bg-success-subtle text-success',
        warning: 'bg-warning-subtle text-warning',
        danger: 'bg-danger-subtle text-danger',
        outline: 'border border-border text-fg-muted',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
)
Badge.displayName = 'Badge'
