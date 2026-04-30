// AppShell — page wrapper for any page that uses the new chrome.
//
// Composition:
//   <AppShell breadcrumb={…} sidebar={<MySidebar />}>
//     <PageBody />
//   </AppShell>
//
// On desktop (>= md), sidebar is always docked. On mobile it lives inside
// a Radix Dialog that the TopBar's hamburger toggles. The collapse state
// is desktop-only — collapsing on mobile would just hide everything.
//
// Pages without a sidebar (Login, public, simple admin pages) can pass
// `sidebar={null}` or just omit the prop. The shell still renders the
// TopBar so the chrome stays consistent.
import { useSyncExternalStore, useState } from 'react'
import { useLocation } from 'react-router-dom'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import TopBar, { type BreadcrumbItem } from './TopBar'
import {
  SidebarCollapseToggle,
  SidebarFooter,
  SidebarProvider,
} from './Sidebar'
import {
  getCollapsed,
  subscribe as subscribeCollapsed,
  toggleCollapsed,
} from '../../lib/sidebar-state'
import { cn } from '../../lib/cn'

export interface AppShellProps {
  breadcrumb?: BreadcrumbItem[]
  /** Sidebar content. Pass undefined or null for pages without a sidebar. */
  sidebar?: React.ReactNode
  /** Main content body. Renders inside a scrollable region. */
  children: React.ReactNode
  /** Skip the default scroll wrapper for full-bleed pages (Map). */
  fullBleed?: boolean
}

export default function AppShell({
  breadcrumb,
  sidebar,
  children,
  fullBleed,
}: AppShellProps) {
  const collapsed = useSyncExternalStore(
    subscribeCollapsed,
    getCollapsed,
    getCollapsed
  )
  const [mobileOpen, setMobileOpen] = useState(false)
  const hasSidebar = !!sidebar
  // Phase E — re-key the <main> on each pathname so the fade-in transition
  // re-runs between routes. Hash changes (#module-…) don't bump the key,
  // which is what we want — anchor scroll shouldn't trigger a fade.
  const { pathname } = useLocation()

  return (
    <div className="flex h-screen flex-col bg-surface text-fg">
      <TopBar
        breadcrumb={breadcrumb}
        onMobileMenuClick={hasSidebar ? () => setMobileOpen(true) : undefined}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Desktop sidebar (docked) */}
        {hasSidebar && (
          <aside
            className={cn(
              'hidden md:flex shrink-0 border-r border-border',
              'h-full overflow-hidden'
            )}
          >
            <SidebarProvider
              collapsed={collapsed}
              onToggleCollapsed={toggleCollapsed}
            >
              <div className="flex h-full w-full flex-col">
                <div className="flex-1 overflow-y-auto">{sidebar}</div>
                {/* Pin a default collapse toggle at the bottom unless the page's
                    own SidebarFooter already includes one — pages that need
                    extra footer items render their own SidebarFooter and the
                    collapse toggle still tucks in via this default block. */}
                <SidebarFooter>
                  <SidebarCollapseToggle />
                </SidebarFooter>
              </div>
            </SidebarProvider>
          </aside>
        )}

        {/* Mobile drawer */}
        {hasSidebar && (
          <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay
                className={cn(
                  'fixed inset-0 z-40 bg-fg/30 backdrop-blur-sm md:hidden',
                  'data-[state=open]:animate-in data-[state=open]:fade-in-0',
                  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0'
                )}
              />
              <DialogPrimitive.Content
                aria-label="Navigation menu"
                style={{ backgroundColor: 'var(--color-bg, #ffffff)' }}
                className={cn(
                  'fixed inset-y-0 left-0 z-50 w-[260px] border-r border-border md:hidden',
                  'data-[state=open]:animate-in data-[state=open]:slide-in-from-left',
                  'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left'
                )}
              >
                <DialogPrimitive.Title className="sr-only">
                  Navigation
                </DialogPrimitive.Title>
                <SidebarProvider collapsed={false}>
                  <div className="flex h-full flex-col">
                    <div className="flex h-12 items-center justify-between border-b border-border px-4">
                      <span className="text-sm font-semibold tracking-tight">
                        Menu
                      </span>
                      <DialogPrimitive.Close
                        className="text-fg-muted hover:text-fg"
                        aria-label="Close menu"
                      >
                        <X className="h-4 w-4" />
                      </DialogPrimitive.Close>
                    </div>
                    <div
                      className="flex-1 overflow-y-auto"
                      // Auto-close the drawer when the user taps a nav item
                      onClick={(e) => {
                        const target = e.target as HTMLElement
                        if (target.closest('a, button')) setMobileOpen(false)
                      }}
                    >
                      {sidebar}
                    </div>
                  </div>
                </SidebarProvider>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>
        )}

        {/* Main content. Re-keyed by pathname so the route-change fade-in
            replays — see comment in the page-transition CSS in index.css. */}
        <main
          key={pathname}
          className={cn(
            'flex-1 min-w-0 motion-safe:animate-page-fade-in',
            fullBleed ? 'overflow-hidden' : 'overflow-y-auto'
          )}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
