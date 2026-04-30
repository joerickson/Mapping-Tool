// Inline-edit primitive. Click the value → input → save (PATCH) or cancel.
//
// One field at a time, single PATCH per save. The owner page is responsible
// for refreshing the property after onSaved fires (we don't try to merge
// the response in here because side effects like re-geocode write more
// than just the patched field).
//
// Variants: text, textarea, number, select, tags. Tags is a chip list with
// inline add/remove.
import { useState, useRef, useEffect } from 'react'
import { Pencil, Check, X, Plus } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import Button from '../ui/Button'
import { Input, Textarea } from '../ui/Input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/Select'
import { cn } from '../../lib/cn'
import type { FieldSpec } from '../../lib/editable-fields'

interface Props {
  spec: FieldSpec
  value: unknown
  endpoint: string // e.g. /api/v1/properties/abc-123 — receives PATCH
  onSaved: () => void
  className?: string
  // Visual override — by default we render the field's `label` above the
  // value. Set this to false when the parent supplies its own label.
  showLabel?: boolean
}

export default function EditableField({
  spec,
  value,
  endpoint,
  onSaved,
  className,
  showLabel = true,
}: Props) {
  const { getToken } = useAuth()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<unknown>(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (editing) setDraft(value)
  }, [editing, value])

  async function save(nextValue: unknown) {
    setSaving(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ [spec.key]: nextValue }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Save failed (${res.status})`)
      }
      setEditing(false)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    setEditing(false)
    setDraft(value)
    setError(null)
  }

  if (!editing) {
    return (
      <div className={cn('group', className)}>
        {showLabel && (
          <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle mb-1">
            {spec.label}
          </p>
        )}
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0 text-sm text-fg">
            <DisplayValue spec={spec} value={value} />
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-fg-subtle hover:text-accent transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
            aria-label={`Edit ${spec.label}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={className}>
      {showLabel && (
        <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle mb-1">
          {spec.label}
        </p>
      )}
      <EditControl spec={spec} value={draft} onChange={setDraft} />
      {spec.helper && <p className="text-[11px] text-fg-subtle mt-1">{spec.helper}</p>}
      {error && <p className="text-xs text-danger mt-1">{error}</p>}
      <div className="flex items-center gap-2 mt-2">
        <Button size="sm" onClick={() => save(draft)} loading={saving}>
          <Check className="h-3.5 w-3.5" />
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={cancel} disabled={saving}>
          <X className="h-3.5 w-3.5" />
          Cancel
        </Button>
      </div>
    </div>
  )
}

function DisplayValue({ spec, value }: { spec: FieldSpec; value: unknown }) {
  if (value == null || value === '') {
    return <span className="text-fg-subtle italic">Not set</span>
  }
  if (spec.kind === 'tags') {
    const tags = Array.isArray(value) ? (value as string[]) : []
    if (tags.length === 0) return <span className="text-fg-subtle italic">No tags</span>
    return (
      <div className="flex flex-wrap gap-1">
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center rounded-md border border-border bg-surface-subtle px-2 py-0.5 text-xs"
          >
            {t}
          </span>
        ))}
      </div>
    )
  }
  if (spec.kind === 'number') {
    return <span className="font-tabular">{Number(value).toLocaleString()}</span>
  }
  if (spec.kind === 'select') {
    const opt = spec.options?.find((o) => o.value === value)
    return <span>{opt?.label ?? String(value)}</span>
  }
  if (spec.kind === 'textarea') {
    return <span className="whitespace-pre-wrap">{String(value)}</span>
  }
  return <span>{String(value)}</span>
}

function EditControl({
  spec,
  value,
  onChange,
}: { spec: FieldSpec; value: unknown; onChange: (v: unknown) => void }) {
  if (spec.kind === 'textarea') {
    return (
      <Textarea
        value={(value as string | null | undefined) ?? ''}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
      />
    )
  }
  if (spec.kind === 'number') {
    return (
      <Input
        type="number"
        value={value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    )
  }
  if (spec.kind === 'select') {
    return (
      <Select
        value={(value as string | undefined) ?? ''}
        onValueChange={(v) => onChange(v)}
      >
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {spec.options?.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  if (spec.kind === 'tags') {
    return <TagsEditor value={(value as string[] | undefined) ?? []} onChange={onChange} />
  }
  return (
    <Input
      value={(value as string | null | undefined) ?? ''}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function TagsEditor({
  value,
  onChange,
}: { value: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  function addTag() {
    const t = draft.trim()
    if (!t || value.includes(t)) return
    onChange([...value, t])
    setDraft('')
    inputRef.current?.focus()
  }
  function remove(t: string) {
    onChange(value.filter((x) => x !== t))
  }
  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-2">
        {value.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-subtle px-2 py-0.5 text-xs"
          >
            {t}
            <button
              type="button"
              onClick={() => remove(t)}
              className="text-fg-subtle hover:text-danger"
              aria-label={`Remove ${t}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addTag()
            }
          }}
          placeholder="Add a tag and press Enter"
        />
        <Button type="button" variant="secondary" size="sm" onClick={addTag}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
