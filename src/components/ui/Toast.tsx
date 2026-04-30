// Toast — themed Radix Toast plus a tiny imperative API on top.
//
// Why an imperative API? Most Toast usage is "I just did X, tell the user".
// A render-prop / context-driven approach forces every page to wire up a
// useToast hook — fine when there's lots of state to share, overkill for
// firing 4-second messages. The toast() function below dispatches via a
// CustomEvent that the <ToastProvider> listens to.
//
// Usage:
//   import { toast } from './Toast'
//   toast.success('Saved')
//   toast.error('Connection lost', { description: 'Retrying in 3s' })
import { forwardRef, useEffect, useState } from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { cn } from '../../lib/cn'

type ToastVariant = 'default' | 'success' | 'error' | 'info'

interface ToastPayload {
  id: number
  title: React.ReactNode
  description?: React.ReactNode
  variant: ToastVariant
  durationMs?: number
}

const TOAST_EVENT = 'portfolioiq:toast'

function dispatch(payload: Omit<ToastPayload, 'id'>) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<ToastPayload>(TOAST_EVENT, {
      detail: { ...payload, id: Date.now() + Math.random() },
    })
  )
}

export const toast = {
  show: (
    title: React.ReactNode,
    opts?: { description?: React.ReactNode; durationMs?: number }
  ) => dispatch({ title, variant: 'default', ...opts }),
  success: (
    title: React.ReactNode,
    opts?: { description?: React.ReactNode; durationMs?: number }
  ) => dispatch({ title, variant: 'success', ...opts }),
  error: (
    title: React.ReactNode,
    opts?: { description?: React.ReactNode; durationMs?: number }
  ) => dispatch({ title, variant: 'error', ...opts }),
  info: (
    title: React.ReactNode,
    opts?: { description?: React.ReactNode; durationMs?: number }
  ) => dispatch({ title, variant: 'info', ...opts }),
}

// Mount once near the root of the app. Listens for toast events and renders
// a queue of <Toast> visuals.
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastPayload[]>([])

  useEffect(() => {
    function onToast(e: Event) {
      const ce = e as CustomEvent<ToastPayload>
      setItems((prev) => [...prev, ce.detail])
    }
    window.addEventListener(TOAST_EVENT, onToast as EventListener)
    return () =>
      window.removeEventListener(TOAST_EVENT, onToast as EventListener)
  }, [])

  return (
    <ToastPrimitive.Provider swipeDirection="right">
      {children}
      {items.map((item) => (
        <ThemedToast
          key={item.id}
          item={item}
          onClose={() =>
            setItems((prev) => prev.filter((p) => p.id !== item.id))
          }
        />
      ))}
      <ToastPrimitive.Viewport
        className={cn(
          'fixed bottom-0 right-0 z-[100] flex max-h-screen w-full flex-col-reverse gap-2 p-4',
          'sm:bottom-auto sm:right-4 sm:top-4 sm:flex-col sm:max-w-[420px]'
        )}
      />
    </ToastPrimitive.Provider>
  )
}

const VARIANT_ICON: Record<ToastVariant, React.ElementType | null> = {
  default: null,
  success: CircleCheck,
  error: CircleAlert,
  info: Info,
}

const VARIANT_ICON_CLASS: Record<ToastVariant, string> = {
  default: 'text-fg-muted',
  success: 'text-success',
  error: 'text-danger',
  info: 'text-accent',
}

function ThemedToast({
  item,
  onClose,
}: {
  item: ToastPayload
  onClose: () => void
}) {
  const Icon = VARIANT_ICON[item.variant]
  return (
    <ToastPrimitive.Root
      duration={item.durationMs ?? 4000}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      className={cn(
        'group pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden',
        'rounded-md border border-border bg-surface-elevated p-4 pr-8 shadow-md',
        'data-[state=open]:animate-in data-[state=open]:slide-in-from-right-full',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full'
      )}
    >
      {Icon && (
        <Icon
          className={cn('h-4 w-4 shrink-0 mt-0.5', VARIANT_ICON_CLASS[item.variant])}
          aria-hidden
        />
      )}
      <div className="flex-1 space-y-1">
        <ToastPrimitive.Title className="text-sm font-medium text-fg leading-tight">
          {item.title}
        </ToastPrimitive.Title>
        {item.description && (
          <ToastPrimitive.Description className="text-xs text-fg-muted">
            {item.description}
          </ToastPrimitive.Description>
        )}
      </div>
      <ToastPrimitive.Close
        className="absolute right-2 top-2 rounded-sm p-0.5 text-fg-subtle opacity-0 transition-opacity hover:text-fg group-hover:opacity-100 focus-visible:opacity-100"
        aria-label="Close"
      >
        <X className="h-3.5 w-3.5" />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  )
}

// Re-export the forwardRef-ready primitive in case a caller wants to
// render its own toast that integrates with the provider.
export const RawToastRoot = forwardRef<
  React.ElementRef<typeof ToastPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root>
>((props, ref) => <ToastPrimitive.Root ref={ref} {...props} />)
RawToastRoot.displayName = 'RawToastRoot'
