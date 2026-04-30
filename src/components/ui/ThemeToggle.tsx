// Phase A theme toggle — sun/moon button cycling light → dark → system.
//
// Three-state cycle (instead of binary light↔dark) lets the user opt back
// into "follow OS" without clearing localStorage by hand. The button shows
// the icon for the *current resolved* theme; the tooltip + aria-label
// describe what clicking will do next.
import { useSyncExternalStore } from 'react'
import {
  getMode,
  getResolvedTheme,
  setMode,
  subscribe,
  type ThemeMode,
} from '../../lib/theme'

const NEXT: Record<ThemeMode, ThemeMode> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
}

const NEXT_LABEL: Record<ThemeMode, string> = {
  light: 'Switch to dark theme',
  dark: 'Switch to system theme',
  system: 'Switch to light theme',
}

// SSR-safe initial value. The bootstrap script has already set data-theme
// before React mounts, so getResolvedTheme() returns the right value
// synchronously on first render.
function snapshot() {
  return `${getMode()}|${getResolvedTheme()}`
}

export default function ThemeToggle({ className }: { className?: string }) {
  // We don't actually use the snapshot string — useSyncExternalStore just
  // gives us a re-render trigger when the theme changes from anywhere.
  useSyncExternalStore(subscribe, snapshot, snapshot)
  const mode = getMode()
  const resolved = getResolvedTheme()

  return (
    <button
      type="button"
      onClick={() => setMode(NEXT[mode])}
      title={NEXT_LABEL[mode]}
      aria-label={NEXT_LABEL[mode]}
      className={
        'inline-flex h-8 w-8 items-center justify-center rounded-md ' +
        'text-fg-muted hover:text-fg hover:bg-surface-muted ' +
        'transition-colors duration-150 focus-visible:outline-none ' +
        'focus-visible:ring-2 focus-visible:ring-accent ' +
        (className ?? '')
      }
    >
      {resolved === 'dark' ? <MoonIcon /> : <SunIcon />}
      {mode === 'system' && <SystemDot />}
    </button>
  )
}

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

// Tiny dot indicating "follow system" — appears in the corner of the icon.
function SystemDot() {
  return (
    <span
      aria-hidden="true"
      className="absolute mt-3 ml-3 h-1.5 w-1.5 rounded-full bg-accent"
    />
  )
}
