// Sidebar collapsed-state manager. Same shape as lib/theme.ts: tiny
// framework-free runtime, components subscribe via useSyncExternalStore.
//
// We persist *only* the collapsed bool. Mobile-drawer open/close is
// component-local (it's a transient UI state, not a preference).
const STORAGE_KEY = 'portfolioiq-sidebar-collapsed'

const listeners = new Set<() => void>()

function readStored(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

let cached = readStored()

export function getCollapsed(): boolean {
  return cached
}

export function setCollapsed(collapsed: boolean) {
  cached = collapsed
  try {
    if (collapsed) window.localStorage.setItem(STORAGE_KEY, '1')
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* storage blocked — still apply for the session */
  }
  for (const fn of listeners) fn()
}

export function toggleCollapsed() {
  setCollapsed(!cached)
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
