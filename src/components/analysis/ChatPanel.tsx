import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import Button from '../ui/Button'

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
      {/* Floating button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-30 bg-blue-600 hover:bg-blue-700 text-white rounded-full px-5 py-3 shadow-lg flex items-center gap-2 text-sm font-medium"
        aria-label="Open analysis chat"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        Chat with Analysis
      </button>

      {/* Drawer */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => setOpen(false)}
          />
          <div className="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[480px] bg-white shadow-2xl flex flex-col">
            <div className="px-5 py-3 border-b flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Analysis Chat</h2>
              <div className="flex gap-2">
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={clearHistory}
                    className="text-xs text-gray-500 hover:text-red-600"
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-gray-400 hover:text-gray-600"
                  aria-label="Close"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {messages.length === 0 && !sending && (
                <div className="text-sm text-gray-600 space-y-2">
                  <p>Ask anything about this portfolio analysis. Try:</p>
                  <div className="grid grid-cols-1 gap-2 mt-2">
                    {EXAMPLE_PROMPTS.map((p, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => send(p)}
                        className="text-left text-xs px-3 py-2 rounded border hover:bg-gray-50 text-gray-700"
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
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Thinking…
                </div>
              )}

              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
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
              className="border-t px-5 py-3 flex gap-2"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about your portfolio…"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
          isUser ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'
        }`}
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
