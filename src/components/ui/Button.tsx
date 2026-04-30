// Button — Phase B replacement of the legacy version.
//
// Public API stayed compatible (variant/size/loading/disabled) so existing
// callers don't change. Internally everything routes through the design
// tokens (bg-accent / bg-surface / text-fg / border-border) so light & dark
// themes work without per-callsite changes.
//
// asChild composes with React Router's <Link> via Radix Slot — useful for
// "button-styled" links in nav contexts. Existing callers can ignore it.
import { forwardRef } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/cn'

export const buttonVariants = cva(
  // Base — every variant gets these. focus-visible keeps the ring keyboard-only.
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md',
    'text-sm font-medium transition-colors duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
    'disabled:pointer-events-none disabled:opacity-50',
  ],
  {
    variants: {
      variant: {
        // Primary: accent fill. Reserve for the page's main CTA.
        primary: 'bg-accent text-accent-fg hover:bg-accent-hover',
        // Secondary: neutral fill with border. Default for most actions.
        secondary:
          'bg-surface text-fg border border-border hover:bg-surface-muted hover:border-border-strong',
        // Ghost: transparent until hover. Use in dense rows / toolbars.
        ghost: 'text-fg-muted hover:bg-surface-muted hover:text-fg',
        // Danger: destructive actions only (delete, discard).
        danger: 'bg-danger text-white hover:opacity-90',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4',
        lg: 'h-10 px-6 text-base',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean
  asChild?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      loading,
      disabled,
      asChild = false,
      children,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {children}
      </Comp>
    )
  }
)
Button.displayName = 'Button'

export default Button
