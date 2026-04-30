// Sidebar — composable building blocks for the left nav. Pages render
// their own content using these primitives; the AppShell handles the
// collapsed / mobile-drawer plumbing.
//
// Structure:
//   <Sidebar>                    — the visible aside (collapsible)
//     <SidebarSection title=…>   — labeled group of items
//       <SidebarItem icon=… to=… active=… badge=…>Label</SidebarItem>
//     </SidebarSection>
//     <SidebarFooter>            — pinned to the bottom (chat button, etc.)
//   </Sidebar>
//
// Collapsed mode hides labels (only icons remain) and centers items.
// Components inside the sidebar read collapsed via the SidebarContext so
// individual items don't have to thread props from the AppShell.
import { createContext, forwardRef, useContext } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../../lib/cn'

interface SidebarContextValue {
  collapsed: boolean
  /** Called by an internal toggle button. AppShell provides this. */
  onToggleCollapsed?: () => void
}

const SidebarContext = createContext<SidebarContextValue>({
  collapsed: false,
})

export function SidebarProvider({
  collapsed,
  onToggleCollapsed,
  children,
}: {
  collapsed: boolean
  onToggleCollapsed?: () => void
  children: React.ReactNode
}) {
  return (
    <SidebarContext.Provider value={{ collapsed, onToggleCollapsed }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  return useContext(SidebarContext)
}

// ── Root ─────────────────────────────────────────────────────────────────────

export interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {}

export const Sidebar = forwardRef<HTMLDivElement, SidebarProps>(
  ({ className, children, ...props }, ref) => {
    const { collapsed } = useSidebar()
    return (
      <div
        ref={ref}
        data-collapsed={collapsed || undefined}
        className={cn(
          'flex h-full flex-col bg-surface-subtle',
          'transition-[width] duration-200 ease-out',
          collapsed ? 'w-14' : 'w-60',
          className
        )}
        {...props}
      >
        {children}
      </div>
    )
  }
)
Sidebar.displayName = 'Sidebar'

// ── Section ──────────────────────────────────────────────────────────────────

export function SidebarSection({
  title,
  children,
  className,
}: {
  title?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  const { collapsed } = useSidebar()
  return (
    <section className={cn('px-2 pt-3 pb-1', className)}>
      {title && !collapsed && (
        <h2 className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
          {title}
        </h2>
      )}
      {/* When collapsed we drop the heading entirely (icon-only mode) and add a
          subtle separator so groups remain distinguishable. */}
      {title && collapsed && (
        <div className="mx-2 mb-1 h-px bg-border" aria-hidden />
      )}
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </section>
  )
}

// ── Item ─────────────────────────────────────────────────────────────────────

export interface SidebarItemProps {
  icon?: LucideIcon
  /** Render a small element on the trailing edge (badge, status dot, count). */
  trailing?: React.ReactNode
  /** Highlight as the active route. AppShell consumers compute this from useLocation. */
  active?: boolean
  /** Disable interaction; renders muted, not clickable. */
  disabled?: boolean
  /** Internal (Link) destination. */
  to?: string
  /** External / button mode. */
  onClick?: () => void
  children: React.ReactNode
  className?: string
}

export function SidebarItem({
  icon: Icon,
  trailing,
  active,
  disabled,
  to,
  onClick,
  children,
  className,
}: SidebarItemProps) {
  const { collapsed } = useSidebar()

  const baseClass = cn(
    'group flex h-8 items-center gap-2 rounded-md px-2 text-sm transition-colors duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
    active
      ? 'bg-surface-muted text-fg font-medium'
      : 'text-fg-muted hover:bg-surface-muted hover:text-fg',
    disabled && 'pointer-events-none opacity-50',
    collapsed && 'justify-center px-0',
    className
  )

  const inner = (
    <>
      {Icon && (
        <Icon
          className={cn('h-4 w-4 shrink-0', active ? 'text-accent' : 'text-fg-subtle group-hover:text-fg')}
          strokeWidth={1.75}
          aria-hidden
        />
      )}
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{children}</span>
          {trailing && <span className="shrink-0">{trailing}</span>}
        </>
      )}
    </>
  )

  return (
    <li>
      {to && !disabled ? (
        <Link
          to={to}
          className={baseClass}
          aria-current={active ? 'page' : undefined}
          title={collapsed && typeof children === 'string' ? children : undefined}
        >
          {inner}
        </Link>
      ) : (
        <button
          type="button"
          onClick={disabled ? undefined : onClick}
          disabled={disabled}
          className={cn(baseClass, 'w-full text-left')}
          title={collapsed && typeof children === 'string' ? children : undefined}
        >
          {inner}
        </button>
      )}
    </li>
  )
}

// ── Footer (pinned bottom) ───────────────────────────────────────────────────

export function SidebarFooter({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'mt-auto border-t border-border px-2 py-2 flex flex-col gap-0.5',
        className
      )}
    >
      {children}
    </div>
  )
}

// ── Collapse toggle (used inside SidebarFooter) ──────────────────────────────

export function SidebarCollapseToggle() {
  const { collapsed, onToggleCollapsed } = useSidebar()
  if (!onToggleCollapsed) return null
  return (
    <button
      type="button"
      onClick={onToggleCollapsed}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      className={cn(
        'inline-flex h-7 items-center gap-2 rounded-md px-2 text-xs',
        'text-fg-subtle hover:bg-surface-muted hover:text-fg transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        collapsed && 'justify-center px-0'
      )}
    >
      {collapsed ? (
        <ChevronRight className="h-3.5 w-3.5" />
      ) : (
        <>
          <ChevronLeft className="h-3.5 w-3.5" />
          <span>Collapse</span>
        </>
      )}
    </button>
  )
}
