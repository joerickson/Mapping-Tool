// Phase 4f-1 — view switcher tabs (Gantt / Calendar / List / Map).
// Keyboard shortcuts: 1, 2, 3, 4.
import { useEffect } from 'react'
import { LayoutGrid, Calendar, List, Map as MapIcon, Activity } from 'lucide-react'
import { cn } from '../../lib/cn'

export type CycleViewKind = 'gantt' | 'calendar' | 'list' | 'map' | 'utilization'

const VIEWS: Array<{ key: CycleViewKind; label: string; icon: any; shortcut: string }> = [
  { key: 'gantt', label: 'Gantt', icon: LayoutGrid, shortcut: '1' },
  { key: 'calendar', label: 'Calendar', icon: Calendar, shortcut: '2' },
  { key: 'list', label: 'List', icon: List, shortcut: '3' },
  { key: 'map', label: 'Map', icon: MapIcon, shortcut: '4' },
  { key: 'utilization', label: 'Utilization', icon: Activity, shortcut: '5' },
]

interface Props {
  value: CycleViewKind
  onChange: (next: CycleViewKind) => void
}

export default function ViewSwitcher({ value, onChange }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const v = VIEWS.find((v) => v.shortcut === e.key)
      if (v) {
        e.preventDefault()
        onChange(v.key)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onChange])

  return (
    <div className="flex items-center gap-1 rounded-md border border-border bg-surface p-1">
      {VIEWS.map((v) => {
        const Icon = v.icon
        const active = value === v.key
        return (
          <button
            key={v.key}
            type="button"
            onClick={() => onChange(v.key)}
            className={cn(
              'flex items-center gap-1.5 rounded px-3 py-1.5 text-sm transition-colors',
              active
                ? 'bg-accent text-white shadow-sm'
                : 'text-fg-muted hover:text-fg hover:bg-surface-subtle'
            )}
            title={`${v.label} (${v.shortcut})`}
          >
            <Icon className="h-3.5 w-3.5" />
            {v.label}
            <span className="ml-1 text-[10px] opacity-60 font-mono">{v.shortcut}</span>
          </button>
        )
      })}
    </div>
  )
}
