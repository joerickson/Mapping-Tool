// Input + Textarea — themed form controls. Keep them small and focused;
// label/helper/error wrappers live in <FormField>.
//
// Visual rules baked in:
//   - 1px border at rest; accent ring on focus-visible.
//   - h-9 (input) / py-2 (textarea) — dense, matches Button/Select sizing.
//   - text-sm — readable but not chunky. Numerals get tabular figures via
//     parent .font-mono wrapper when used in metrics.
import { forwardRef } from 'react'
import { cn } from '../../lib/cn'

const baseFieldClass =
  'w-full rounded-md border border-border bg-surface text-fg placeholder:text-fg-subtle ' +
  'transition-colors duration-150 ' +
  'focus-visible:outline-none focus-visible:border-border-focus focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(
        baseFieldClass,
        'h-9 px-3 text-sm',
        invalid && 'border-danger focus-visible:ring-danger',
        className
      )}
      {...props}
    />
  )
)
Input.displayName = 'Input'

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, ...props }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        baseFieldClass,
        'min-h-[72px] px-3 py-2 text-sm leading-normal resize-y',
        invalid && 'border-danger focus-visible:ring-danger',
        className
      )}
      {...props}
    />
  )
)
Textarea.displayName = 'Textarea'

// Label — exposes Radix's label so screen readers wire htmlFor correctly.
import * as LabelPrimitive from '@radix-ui/react-label'

export const Label = forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      'text-xs font-medium text-fg-muted leading-none ' +
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
      className
    )}
    {...props}
  />
))
Label.displayName = 'Label'

// FormField — common label-above + control + helper-or-error layout.
// Use this for 90% of forms; drop down to bare <Label>/<Input> for weird
// layouts (inline filters, side-by-side sliders).
export interface FormFieldProps {
  label?: React.ReactNode
  htmlFor?: string
  helper?: React.ReactNode
  error?: React.ReactNode
  className?: string
  children: React.ReactNode
}

export function FormField({
  label,
  htmlFor,
  helper,
  error,
  className,
  children,
}: FormFieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <Label htmlFor={htmlFor} className="uppercase tracking-wide">
          {label}
        </Label>
      )}
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : helper ? (
        <p className="text-xs text-fg-subtle">{helper}</p>
      ) : null}
    </div>
  )
}
