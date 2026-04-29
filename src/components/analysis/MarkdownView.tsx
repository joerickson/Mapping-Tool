// Lightweight markdown renderer. The synthesizer produces a known-shape
// markdown report (h1, h2, paragraphs, lists, bold). Pulling in react-markdown
// for that is overkill, so we render the few syntactic features we use
// directly. Anything we don't recognize falls through as styled text.
import { Fragment } from 'react'

export default function MarkdownView({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: React.ReactNode[] = []

  let para: string[] = []
  let list: string[] = []
  let listKind: 'ul' | 'ol' | null = null

  const flushPara = () => {
    if (para.length) {
      blocks.push(
        <p key={blocks.length} className="text-sm text-gray-700 leading-relaxed mb-3">
          {renderInline(para.join(' '))}
        </p>
      )
      para = []
    }
  }
  const flushList = () => {
    if (list.length && listKind) {
      const Tag = listKind
      blocks.push(
        <Tag
          key={blocks.length}
          className={`text-sm text-gray-700 mb-3 ml-5 ${listKind === 'ul' ? 'list-disc' : 'list-decimal'} space-y-1`}
        >
          {list.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </Tag>
      )
      list = []
      listKind = null
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()

    if (!line.trim()) {
      flushPara()
      flushList()
      continue
    }

    // Headers
    const h1 = /^#\s+(.+)$/.exec(line)
    const h2 = /^##\s+(.+)$/.exec(line)
    const h3 = /^###\s+(.+)$/.exec(line)
    if (h1) {
      flushPara()
      flushList()
      blocks.push(
        <h1 key={blocks.length} className="text-xl font-bold text-gray-900 mt-6 mb-3 first:mt-0">
          {renderInline(h1[1])}
        </h1>
      )
      continue
    }
    if (h2) {
      flushPara()
      flushList()
      blocks.push(
        <h2 key={blocks.length} className="text-base font-semibold text-gray-900 mt-5 mb-2">
          {renderInline(h2[1])}
        </h2>
      )
      continue
    }
    if (h3) {
      flushPara()
      flushList()
      blocks.push(
        <h3 key={blocks.length} className="text-sm font-semibold text-gray-800 mt-4 mb-1.5">
          {renderInline(h3[1])}
        </h3>
      )
      continue
    }

    // Lists
    const ul = /^[-*]\s+(.+)$/.exec(line)
    const ol = /^\d+\.\s+(.+)$/.exec(line)
    if (ul) {
      flushPara()
      if (listKind && listKind !== 'ul') flushList()
      listKind = 'ul'
      list.push(ul[1])
      continue
    }
    if (ol) {
      flushPara()
      if (listKind && listKind !== 'ol') flushList()
      listKind = 'ol'
      list.push(ol[1])
      continue
    }

    // Horizontal rule
    if (/^---+$/.test(line)) {
      flushPara()
      flushList()
      blocks.push(<hr key={blocks.length} className="border-t my-4" />)
      continue
    }

    // Plain paragraph line — keep accumulating
    if (listKind) flushList()
    para.push(line.trim())
  }

  flushPara()
  flushList()

  return <div className="prose-like">{blocks}</div>
}

// Inline formatting: **bold**, `code`, [link](url)
function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  // Pattern matches one of: **...**, `...`, [text](url)
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(<Fragment key={i++}>{text.slice(last, m.index)}</Fragment>)
    const tok = m[0]
    if (tok.startsWith('**') && tok.endsWith('**')) {
      parts.push(<strong key={i++}>{tok.slice(2, -2)}</strong>)
    } else if (tok.startsWith('`') && tok.endsWith('`')) {
      parts.push(
        <code key={i++} className="font-mono text-xs px-1 py-0.5 rounded bg-gray-100">
          {tok.slice(1, -1)}
        </code>
      )
    } else {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)
      if (linkMatch) {
        parts.push(
          <a key={i++} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
            {linkMatch[1]}
          </a>
        )
      } else {
        parts.push(<Fragment key={i++}>{tok}</Fragment>)
      }
    }
    last = m.index + tok.length
  }
  if (last < text.length) parts.push(<Fragment key={i++}>{text.slice(last)}</Fragment>)
  return <>{parts}</>
}
