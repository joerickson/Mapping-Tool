// Phase 4f-1 — undo/redo history drawer.
// Floating button toggles the drawer. Lists last 50 edits with
// undo/redo actions.
import { useEffect, useState, useCallback } from 'react'
import { History, Undo2, Redo2, X } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import Button from '../ui/Button'
import { cn } from '../../lib/cn'

interface EditRow {
  id: string
  edit_index: number
  edit_type: string
  description: string | null
  edited_by: string | null
  edited_at: string
  is_active: boolean
  undone_at: string | null
  propagated_to_template: boolean
}

interface Props {
  cycleId: string
  onChange: () => void // called after undo/redo so caller can reload
}

export default function HistoryDrawer({ cycleId, onChange }: Props) {
  const { getToken } = useAuth()
  const [open, setOpen] = useState(false)
  const [edits, setEdits] = useState<EditRow[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<'undo' | 'redo' | null>(null)

  const load = useCallback(async () => {
    if (!cycleId) return
    setLoading(true)
    try {
      const token = await getToken()
      const res = await fetch(`/api/scheduler/cycles/${cycleId}/edit-history`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setEdits(data.edits ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [cycleId, getToken])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const undo = useCallback(async () => {
    setBusy('undo')
    try {
      const token = await getToken()
      const res = await fetch(`/api/scheduler/cycles/${cycleId}/undo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        await load()
        onChange()
      }
    } finally {
      setBusy(null)
    }
  }, [cycleId, getToken, load, onChange])

  const redo = useCallback(async () => {
    setBusy('redo')
    try {
      const token = await getToken()
      const res = await fetch(`/api/scheduler/cycles/${cycleId}/redo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        await load()
        onChange()
      }
    } finally {
      setBusy(null)
    }
  }, [cycleId, getToken, load, onChange])

  // Keyboard shortcuts: H toggles drawer, Cmd+Z undo, Cmd+Shift+Z redo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      const target = e.target as HTMLElement
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (meta && (e.key === 'Z' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault()
        redo()
      } else if (e.key === 'h' && !meta && !e.shiftKey) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [undo, redo])

  const activeCount = edits.filter((e) => e.is_active).length

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-16 right-4 z-30 flex items-center gap-2 rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm shadow-md hover:bg-surface-subtle transition-colors"
        title="History (H)"
      >
        <History className="h-4 w-4" />
        <span className="font-tabular text-xs">History · {activeCount}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-fg/30" onClick={() => setOpen(false)} />
          <aside
            style={{ backgroundColor: 'var(--color-bg-elevated, #ffffff)' }}
            className="fixed right-0 top-0 bottom-0 z-50 w-96 border-l border-border shadow-2xl flex flex-col"
          >
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <p className="text-base font-semibold text-fg">Edit history</p>
                <p className="text-xs text-fg-muted">
                  Cmd+Z to undo · Cmd+Shift+Z to redo
                </p>
              </div>
              <button onClick={() => setOpen(false)} className="text-fg-muted hover:text-fg">
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="flex items-center gap-2 border-b border-border px-4 py-2 bg-surface-subtle">
              <Button size="sm" variant="secondary" onClick={undo} loading={busy === 'undo'}>
                <Undo2 className="h-3.5 w-3.5" /> Undo
              </Button>
              <Button size="sm" variant="secondary" onClick={redo} loading={busy === 'redo'}>
                <Redo2 className="h-3.5 w-3.5" /> Redo
              </Button>
              <Button size="sm" variant="ghost" onClick={load}>
                Refresh
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <p className="p-4 text-sm text-fg-muted">Loading…</p>
              ) : edits.length === 0 ? (
                <p className="p-4 text-sm text-fg-muted">No edits yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {edits.map((e) => (
                    <li
                      key={e.id}
                      className={cn(
                        'px-4 py-2.5',
                        !e.is_active && 'opacity-50 line-through decoration-fg-subtle'
                      )}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm text-fg">{e.description ?? e.edit_type}</p>
                        <span className="text-[10px] text-fg-subtle font-tabular whitespace-nowrap">
                          #{e.edit_index}
                        </span>
                      </div>
                      <p className="text-[11px] text-fg-muted font-tabular">
                        {new Date(e.edited_at).toLocaleString()}
                        {e.edited_by && ` · ${e.edited_by}`}
                        {e.propagated_to_template && ' · template'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </>
      )}
    </>
  )
}
