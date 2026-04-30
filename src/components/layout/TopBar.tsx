// TopBar — 48px sticky bar shown on every AppShell page. Replaces the
// legacy <Navbar> visually but only for pages that have migrated.
//
// Layout:
//   [hamburger]  [logo · breadcrumb]                [theme] [user]
//                                                ^^ flex spacer
//
// The hamburger only appears on screens < md and toggles the sidebar
// drawer. On desktop the sidebar is always docked, so no hamburger.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, LogOut, Menu, Settings, User } from 'lucide-react'
import ThemeToggle from '../ui/ThemeToggle'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/DropdownMenu'
import { cn } from '../../lib/cn'
import { supabase } from '../../lib/supabase/client'

export interface BreadcrumbItem {
  label: React.ReactNode
  /** Falsy = render as plain text (final segment). */
  to?: string | null
}

export interface TopBarProps {
  breadcrumb?: BreadcrumbItem[]
  /** Called by AppShell when the hamburger is tapped on mobile. */
  onMobileMenuClick?: () => void
}

export default function TopBar({ breadcrumb, onMobileMenuClick }: TopBarProps) {
  return (
    <header
      className={cn(
        'h-12 shrink-0 border-b border-border bg-surface',
        'flex items-center gap-3 px-4'
      )}
    >
      {onMobileMenuClick && (
        <button
          type="button"
          onClick={onMobileMenuClick}
          aria-label="Open navigation menu"
          className={cn(
            'inline-flex h-8 w-8 items-center justify-center rounded-md',
            'text-fg-muted hover:text-fg hover:bg-surface-muted transition-colors',
            'md:hidden'
          )}
        >
          <Menu className="h-4 w-4" />
        </button>
      )}

      <Link
        to="/accounts"
        className="flex items-center gap-2 text-sm font-semibold tracking-tight text-fg shrink-0"
      >
        <LogoMark />
        <span>PortfolioIQ</span>
      </Link>

      {breadcrumb && breadcrumb.length > 0 && (
        <nav
          aria-label="Breadcrumb"
          className="hidden sm:flex items-center gap-1.5 text-sm text-fg-muted min-w-0"
        >
          <span className="text-fg-subtle" aria-hidden>
            <ChevronRight className="h-3.5 w-3.5" />
          </span>
          <ol className="flex items-center gap-1.5 min-w-0">
            {breadcrumb.map((item, i) => {
              const isLast = i === breadcrumb.length - 1
              const content = (
                <span
                  className={cn(
                    'truncate',
                    isLast ? 'text-fg' : 'text-fg-muted hover:text-fg'
                  )}
                >
                  {item.label}
                </span>
              )
              return (
                <li
                  key={i}
                  className="flex items-center gap-1.5 min-w-0"
                  aria-current={isLast ? 'page' : undefined}
                >
                  {item.to && !isLast ? (
                    <Link to={item.to}>{content}</Link>
                  ) : (
                    content
                  )}
                  {!isLast && (
                    <span className="text-fg-subtle" aria-hidden>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        </nav>
      )}

      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  )
}

// Minimal logo mark — square with a simple accent corner. Avoids the
// gradient-pin-icon look from the legacy Navbar (which read as a brand
// asset for "RBM Geo", not a software product).
function LogoMark() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-accent text-accent-fg text-[11px] font-semibold"
    >
      P
    </span>
  )
}

// Read the supabase user once on mount. Async fetch so we don't widen the
// useAuth contract just for a label.
function useCurrentUserEmail(): string | null {
  const [email, setEmail] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) setEmail(session?.user?.email ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return email
}

function UserMenu() {
  const email = useCurrentUserEmail()
  const navigate = useNavigate()
  const initial = (email ?? '?').charAt(0).toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Open user menu"
          className={cn(
            'inline-flex h-8 w-8 items-center justify-center rounded-full',
            'border border-border bg-surface-subtle text-fg-muted',
            'text-xs font-medium hover:bg-surface-muted hover:text-fg transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'
          )}
        >
          {initial}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[14rem]">
        {email && (
          <>
            <DropdownMenuLabel className="normal-case font-normal text-fg-muted text-xs">
              {email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem disabled>
          <User className="h-4 w-4" /> Profile
          <span className="ml-auto text-[10px] text-fg-subtle uppercase">
            Soon
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <Settings className="h-4 w-4" /> Settings
          <span className="ml-auto text-[10px] text-fg-subtle uppercase">
            Soon
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/logout')}>
          <LogOut className="h-4 w-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
