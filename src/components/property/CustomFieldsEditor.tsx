// Generic key/value editor for jsonb fields. Used by the SL edit dialog
// for `custom_fields`. The shape is `Record<string, string | number>` —
// values are stored as text in the input but kept as their native type
// when they parse cleanly as numbers, so jsonb numeric queries still work.
import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import Button from '../ui/Button'
import { Input } from '../ui/Input'

interface Props {
  value: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}

const KEY_RE = /^[a-z0-9_-]{1,50}$/i

export default function CustomFieldsEditor({ value, onChange }: Props) {
  const [draftKey, setDraftKey] = useState('')
  const [draftValue, setDraftValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  const entries = Object.entries(value ?? {})

  function setEntry(key: string, raw: string) {
    // Auto-convert numeric strings so jsonb numeric ops keep working.
    const trimmed = raw.trim()
    const asNum = Number(trimmed)
    const next: Record<string, unknown> = { ...value }
    if (trimmed !== '' && Number.isFinite(asNum) && trimmed === String(asNum)) {
      next[key] = asNum
    } else {
      next[key] = raw
    }
    onChange(next)
  }

  function removeEntry(key: string) {
    const next = { ...value }
    delete next[key]
    onChange(next)
  }

  function addEntry() {
    setError(null)
    const k = draftKey.trim()
    if (!k) {
      setError('Key is required.')
      return
    }
    if (!KEY_RE.test(k)) {
      setError('Key must be 1–50 chars, alphanumeric + dashes/underscores.')
      return
    }
    if (k in (value ?? {})) {
      setError(`Key "${k}" already exists.`)
      return
    }
    onChange({ ...value, [k]: draftValue })
    setDraftKey('')
    setDraftValue('')
  }

  return (
    <div className="space-y-2">
      {entries.length === 0 ? (
        <p className="text-xs text-fg-subtle italic">No custom fields yet.</p>
      ) : (
        <ul className="space-y-1">
          {entries.map(([k, v]) => (
            <li key={k} className="grid grid-cols-[1fr_2fr_auto] gap-2 items-center">
              <span className="font-mono text-xs text-fg truncate" title={k}>
                {k}
              </span>
              <Input
                value={v == null ? '' : String(v)}
                onChange={(e) => setEntry(k, e.target.value)}
              />
              <button
                type="button"
                onClick={() => removeEntry(k)}
                className="text-fg-subtle hover:text-danger transition-colors"
                aria-label={`Remove ${k}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-[1fr_2fr_auto] gap-2 items-center">
        <Input
          value={draftKey}
          onChange={(e) => setDraftKey(e.target.value)}
          placeholder="key"
          className="font-mono text-xs"
        />
        <Input
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          placeholder="value"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEntry() } }}
        />
        <Button type="button" variant="secondary" size="sm" onClick={addEntry}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  )
}
