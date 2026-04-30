// Theme manager — small, framework-free runtime that the React tree
// subscribes to via useSyncExternalStore.
//
// Storage contract:
//   localStorage['portfolioiq-theme'] = 'light' | 'dark' | (absent = 'system')
// The bootstrap script in index.html resolves this to 'light' or 'dark' at
// page load and sets data-theme on <html>. After mount, calls to setTheme()
// here keep the attribute and the storage in sync.
//
// We intentionally don't track the system preference inside React state —
// the OS-level media query is the source of truth when mode is 'system'.
// Components just observe the resolved attribute on <html> via the listener.

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'portfolioiq-theme'

const listeners = new Set<() => void>()

function readSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function readStoredMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system'
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark') return v
    return 'system'
  } catch {
    return 'system'
  }
}

function applyResolved(resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', resolved)
}

export function getMode(): ThemeMode {
  return readStoredMode()
}

export function getResolvedTheme(): ResolvedTheme {
  const mode = readStoredMode()
  return mode === 'system' ? readSystemTheme() : mode
}

export function setMode(mode: ThemeMode) {
  try {
    if (mode === 'system') window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    /* storage blocked — still apply for the session */
  }
  const resolved: ResolvedTheme = mode === 'system' ? readSystemTheme() : mode
  applyResolved(resolved)
  for (const fn of listeners) fn()
}

// React adapter — used by ThemeToggle (and any other component that needs to
// reflect the active mode in its UI).
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Also listen for OS-level pref changes when mode === 'system'.
  let mql: MediaQueryList | null = null
  if (typeof window !== 'undefined' && window.matchMedia) {
    mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onSystemChange = () => {
      if (readStoredMode() === 'system') {
        applyResolved(readSystemTheme())
        for (const fn of listeners) fn()
      }
    }
    mql.addEventListener('change', onSystemChange)
    return () => {
      listeners.delete(listener)
      mql?.removeEventListener('change', onSystemChange)
    }
  }
  return () => {
    listeners.delete(listener)
  }
}
