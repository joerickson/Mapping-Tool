// Phase 4.5 — Cycle chat drawer.
// Slide-out from the right with a message list + input. Calls
// /api/scheduler/cycles/[cycleId]/chat which builds a system prompt
// from the cycle's actual data (visits, crew_days, pacing, unplaced).
// Conversation is component-local — no DB persistence in v1.
import { useEffect, useRef, useState } from 'react'
import { MessageSquare, Send, X } from 'lucide-react'
import Button from '../ui/Button'
import { Textarea } from '../ui/Input'
import { useAuth } from '../../hooks/useAuth'

interface ToolEvent {
  tool: string
  input: Record<string, unknown>
  result: { ok: boolean; summary: string; data?: unknown }
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  events?: ToolEvent[]
}

interface Props {
  cycleId: string
  cycleLabel?: string | null
  onCycleRegenerated?: () => void | Promise<void>
}

export default function CycleChatDrawer({ cycleId, cycleLabel, onCycleRegenerated }: Props) {
  const { getToken } = useAuth()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages, sending])

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    const next = [...messages, { role: 'user' as const, content: text }]
    setMessages(next)
    setInput('')
    setSending(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/scheduler/cycles/${cycleId}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messages: next }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error((json as any).error ?? `HTTP ${res.status}`)
      }
      const events = ((json as any).events ?? []) as ToolEvent[]
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: (json as any).message ?? '', events },
      ])
      // If the agent ran a regenerate, refresh the parent cycle data.
      if (events.some((e) => e.tool === 'regenerate' && e.result.ok)) {
        await onCycleRegenerated?.()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        title="Chat with this cycle"
      >
        <MessageSquare className="h-4 w-4" /> Chat
      </Button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => setOpen(false)}
          />
          <aside
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border bg-surface shadow-xl"
            style={{ backgroundColor: 'var(--color-bg-elevated, #ffffff)' }}
          >
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-fg">Chat with cycle</h2>
                <p className="text-[11px] text-fg-muted">
                  {cycleLabel ?? 'Ask in plain English — the agent can rebalance staging, change crew counts, and regenerate the cycle.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-fg-subtle hover:text-fg"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {messages.length === 0 && (
                <div className="rounded-md border border-border bg-surface-subtle p-3 text-xs text-fg-muted">
                  Ask in plain English. The agent can ANALYZE the cycle and
                  also EXECUTE staging changes and regenerate.
                  <ul className="mt-2 space-y-1">
                    {[
                      'Spread out idle days so they aren\'t all at the end of the cycle',
                      'Drop to 13 crews and rebalance',
                      'Move a crew from Lindon to Phoenix',
                      'Why are these properties unplaced?',
                      'What would help reduce the crew end-day spread?',
                    ].map((q) => (
                      <li key={q}>
                        <button
                          type="button"
                          onClick={() => setInput(q)}
                          className="text-accent hover:underline text-left"
                        >
                          {q}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className="space-y-1.5">
                  {m.events && m.events.length > 0 && (
                    <ul className="space-y-1">
                      {m.events.map((ev, j) => (
                        <li
                          key={j}
                          className={
                            'rounded-md border px-2.5 py-1.5 text-[11px] flex items-start gap-2 ' +
                            (ev.result.ok
                              ? 'border-success/30 bg-success-subtle/40 text-fg'
                              : 'border-danger/30 bg-danger-subtle/40 text-fg')
                          }
                          title={JSON.stringify(ev.input)}
                        >
                          <span className="font-mono text-fg-muted">
                            {ev.result.ok ? '✓' : '✕'} {ev.tool}
                          </span>
                          <span className="flex-1 text-fg-muted">{ev.result.summary}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {m.content && (
                    <div
                      className={
                        m.role === 'user'
                          ? 'rounded-md bg-accent/10 border border-accent/20 px-3 py-2 text-sm text-fg whitespace-pre-wrap'
                          : 'rounded-md bg-surface-subtle border border-border px-3 py-2 text-sm text-fg whitespace-pre-wrap'
                      }
                    >
                      {m.content}
                    </div>
                  )}
                </div>
              ))}
              {sending && (
                <div className="rounded-md bg-surface-subtle border border-border px-3 py-2 text-xs text-fg-muted italic">
                  Thinking…
                </div>
              )}
              {error && (
                <div className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-xs text-danger">
                  {error}
                </div>
              )}
            </div>

            <footer className="border-t border-border p-3">
              <div className="flex items-end gap-2">
                <Textarea
                  rows={2}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      send()
                    }
                  }}
                  placeholder="Ask about this cycle…"
                  disabled={sending}
                  className="flex-1 text-sm"
                />
                <Button onClick={send} disabled={sending || !input.trim()} size="sm">
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="mt-1 text-[10px] text-fg-subtle">
                Enter to send · Shift+Enter for newline · conversation is not saved
              </p>
            </footer>
          </aside>
        </>
      )}
    </>
  )
}
