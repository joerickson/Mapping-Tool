import { useEffect, useRef, useState } from 'react'
import { Loader2, MessageCircle, X } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import Button from '../ui/Button'
import { Input } from '../ui/Input'
import { cn } from '../../lib/cn'

interface ChatMessage {
  id?: string
  role: 'user' | 'assistant'
  content: string
  metadata?: any
  created_at?: string
}

const EXAMPLE_PROMPTS = [
  'Which 5 properties contribute the most to drive cost?',
  'What if I dropped the Houston branch? What is the cost impact?',
  'How many additional crews would I need at K=3?',
  'Compare K=3 vs K=4 vs K=5 for cost and risk.',
]

export default function ChatPanel({ accountId, clientId }: { accountId: string; clientId: string }) {
  const { getToken } = useAuth()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Load history when panel opens
  useEffect(() => {
    if (!open || loaded) return
    let cancelled = false
    async function load() {
      try {
        const token = await getToken()
        const res = await fetch(`/api/analyses/account/${accountId}/clients/${clientId}/chat`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return
        const json = (await res.json()) as ChatMessage[]
        if (!cancelled) {
          setMessages(json)
          setLoaded(true)
        }
      } catch {
        /* ignore */
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [open, loaded, accountId, clientId, getToken])

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, sending])

  const send = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setError(null)
    setSending(true)
    setInput('')
    // Optimistic user message
    setMessages((cur) => [...cur, { role: 'user', content: trimmed }])
    try {
      const token = await getToken()
      const res = await fetch(`/api/analyses/account/${accountId}/clients/${clientId}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: trimmed }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? `HTTP ${res.status}`)
        return
      }
      setMessages((cur) => [
        ...cur,
        { role: 'assistant', content: json.content ?? '(no response)', metadata: json.metadata },
      ])
    } catch (err: any) {
      setError(err?.message ?? String(err))
    } finally {
      setSending(false)
    }
  }

  const clearHistory = async () => {
    if (!confirm('Clear chat history for this account?')) return
    const token = await getToken()
    await fetch(`/api/analyses/account/${accountId}/clients/${clientId}/chat`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    setMessages([])
  }

  return (
    <>
      {/* Floating button. Round, accent fill, icon-only on small screens to
          avoid colliding with bottom-right toasts. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          'fixed bottom-6 right-6 z-30 inline-flex items-center gap-2 ' +
          'rounded-full bg-accent text-accent-fg ' +
          'h-12 px-5 text-sm font-medium ' +
          'transition-colors duration-150 hover:bg-accent-hover ' +
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface'
        }
        aria-label="Open analysis chat"
      >
        <MessageCircle className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">Chat</span>
      </button>

      {/* Drawer */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-fg/30 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="fixed right-0 top-0 bottom-0 z-50 flex w-full flex-col border-l border-border bg-surface shadow-lg sm:w-[480px]">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <h2 className="text-base font-semibold tracking-tight text-fg">
                Analysis chat
              </h2>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={clearHistory}
                    className="rounded-sm px-2 py-1 text-xs text-fg-muted hover:text-danger transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:text-fg hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-5 py-4 space-y-3"
            >
              {messages.length === 0 && !sending && (
                <div className="space-y-3 text-sm text-fg-muted">
                  <p>Ask anything about this portfolio analysis. Try:</p>
                  <div className="grid grid-cols-1 gap-2">
                    {EXAMPLE_PROMPTS.map((p, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => send(p)}
                        className="rounded-md border border-border bg-surface px-3 py-2 text-left text-xs text-fg-muted transition-colors hover:bg-surface-muted hover:border-border-strong hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <ChatBubble key={m.id ?? i} message={m} />
              ))}

              {sending && (
                <div className="flex items-center gap-2 text-sm text-fg-muted">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Thinking…
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="rounded-md border border-danger/20 bg-danger-subtle px-3 py-2 text-sm text-danger"
                >
                  {error}
                </div>
              )}
            </div>

            {/* Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                send(input)
              }}
              className="flex gap-2 border-t border-border px-5 py-3"
            >
              <Input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about your portfolio…"
                className="flex-1"
                disabled={sending}
                autoFocus
              />
              <Button size="sm" type="submit" loading={sending} disabled={sending || !input.trim()}>
                Send
              </Button>
            </form>
          </div>
        </>
      )}
    </>
  )
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
          isUser
            ? 'bg-accent text-accent-fg'
            : 'bg-surface-muted text-fg'
        )}
      >
        {message.content}
        {message.metadata?.tool_calls?.length > 0 && (
          <details className="mt-2 text-xs opacity-80">
            <summary className="cursor-pointer">
              Tool calls ({message.metadata.tool_calls.length})
            </summary>
            <ul className="mt-1 space-y-0.5 font-mono">
              {message.metadata.tool_calls.map((t: any, i: number) => (
                <li key={i}>
                  · {t.name}({JSON.stringify(t.input).slice(0, 80)})
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  )
}
