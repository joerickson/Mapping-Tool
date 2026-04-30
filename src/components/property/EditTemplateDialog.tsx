// EditTemplateDialog — create/edit a constraint template.
// A template is { name, description, constraints[] }. The constraints[]
// editor is a small builder: pick type → enforcement → config → "Add to
// template", with the existing constraints listed above as removable chips.
import { useState, useEffect } from 'react'
import { Trash2, Plus } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import Button from '../ui/Button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/Dialog'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
} from '../ui/Select'
import { Input, Textarea, FormField } from '../ui/Input'
import { Badge } from '../ui/Badge'
import { cn } from '../../lib/cn'
import {
  CONSTRAINT_LABELS,
  CONSTRAINT_DESCRIPTIONS,
  CONSTRAINT_GROUPS,
  type ConstraintType,
} from './constraint-types'
import ConstraintConfigEditor, { defaultConfigForType } from './ConstraintConfigEditor'

export interface TemplateConstraint {
  constraint_type: ConstraintType | string
  enforcement: 'hard' | 'soft'
  config: Record<string, unknown>
  notes?: string | null
}

export interface ConstraintTemplate {
  id: string
  account_id: string
  client_id: string
  name: string
  description: string | null
  constraints: TemplateConstraint[]
  created_at: string
  updated_at: string
}

interface Props {
  open: boolean
  onClose: () => void
  accountId: string
  clientId: string
  // null → create mode. Non-null → edit mode for this template.
  template: ConstraintTemplate | null
  onSaved: () => void
}

export default function EditTemplateDialog({
  open,
  onClose,
  accountId,
  clientId,
  template,
  onSaved,
}: Props) {
  const { getToken } = useAuth()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [constraints, setConstraints] = useState<TemplateConstraint[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Builder state — the half of the dialog where the user composes ONE
  // constraint to add to the template's list.
  const [draftType, setDraftType] = useState<ConstraintType>('day_of_week')
  const [draftEnforcement, setDraftEnforcement] = useState<'hard' | 'soft'>('hard')
  const [draftConfig, setDraftConfig] = useState<Record<string, unknown>>(() =>
    defaultConfigForType('day_of_week')
  )

  useEffect(() => {
    if (open) {
      setName(template?.name ?? '')
      setDescription(template?.description ?? '')
      setConstraints(template?.constraints ?? [])
      setDraftType('day_of_week')
      setDraftEnforcement('hard')
      setDraftConfig(defaultConfigForType('day_of_week'))
      setError(null)
    }
  }, [open, template])

  function changeDraftType(t: ConstraintType) {
    setDraftType(t)
    setDraftConfig(defaultConfigForType(t))
  }

  function addDraftToTemplate() {
    setConstraints([
      ...constraints,
      { constraint_type: draftType, enforcement: draftEnforcement, config: draftConfig },
    ])
    // Reset the builder to a fresh starting point so the user can chain
    // multiple constraints without thinking about state.
    setDraftType('day_of_week')
    setDraftEnforcement('hard')
    setDraftConfig(defaultConfigForType('day_of_week'))
  }

  function removeAt(i: number) {
    setConstraints(constraints.filter((_, idx) => idx !== i))
  }

  async function handleSave() {
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    if (constraints.length === 0) {
      setError('Add at least one constraint to the template.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const token = await getToken()
      const url = template
        ? `/api/accounts/${accountId}/clients/${clientId}/constraint-templates/${template.id}`
        : `/api/accounts/${accountId}/clients/${clientId}/constraint-templates`
      const res = await fetch(url, {
        method: template ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: name.trim(), description, constraints }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const detail = Array.isArray(body.details) ? ` — ${body.details.join('; ')}` : ''
        throw new Error(`${body.error ?? `Save failed (${res.status})`}${detail}`)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{template ? 'Edit template' : 'New template'}</DialogTitle>
          <DialogDescription>
            Bundle constraints into a template, then apply it to many service locations in one go.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1 -mr-1">
          <FormField label="Name" htmlFor="tpl-name">
            <Input
              id="tpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Standard retail M–F 8a–6p"
            />
          </FormField>

          <FormField label="Description (optional)" htmlFor="tpl-desc">
            <Textarea
              id="tpl-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="When to use this template…"
            />
          </FormField>

          {/* Existing constraints in the template */}
          <FormField label={`Constraints (${constraints.length})`}>
            {constraints.length === 0 ? (
              <p className="text-xs text-fg-muted italic">
                No constraints yet. Add one below.
              </p>
            ) : (
              <ul className="space-y-2">
                {constraints.map((c, i) => (
                  <li
                    key={i}
                    className={cn(
                      'rounded-md border-l-2 bg-surface-subtle px-3 py-2',
                      c.enforcement === 'hard' ? 'border-accent' : 'border-fg-subtle'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-fg">
                          {CONSTRAINT_LABELS[c.constraint_type as ConstraintType] ?? c.constraint_type}
                        </span>
                        <Badge variant={c.enforcement === 'hard' ? 'accent' : 'outline'}>
                          {c.enforcement}
                        </Badge>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeAt(i)}
                        className="text-fg-subtle hover:text-danger transition-colors"
                        aria-label="Remove constraint"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </FormField>

          {/* Builder — compose ONE constraint to add */}
          <div className="rounded-md border border-border bg-surface-subtle p-4 space-y-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
              Add a constraint
            </p>

            <FormField label="Type" helper={CONSTRAINT_DESCRIPTIONS[draftType]}>
              <Select value={draftType} onValueChange={(v) => changeDraftType(v as ConstraintType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONSTRAINT_GROUPS.map((g) => (
                    <SelectGroup key={g.label}>
                      <SelectLabel>{g.label}</SelectLabel>
                      {g.types.map((t) => (
                        <SelectItem key={t} value={t}>{CONSTRAINT_LABELS[t]}</SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField label="Enforcement">
              <div className="flex gap-2">
                {(['hard', 'soft'] as const).map((opt) => {
                  const selected = draftEnforcement === opt
                  return (
                    <button
                      key={opt}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setDraftEnforcement(opt)}
                      className={cn(
                        'flex-1 rounded-md border-2 px-3 py-2 text-sm transition-colors',
                        selected
                          ? 'border-accent bg-accent text-accent-fg'
                          : 'border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg'
                      )}
                    >
                      <span className="font-medium capitalize">{opt}</span>
                      <span
                        className={cn(
                          'block text-[11px] mt-0.5',
                          selected ? 'text-accent-fg/80' : 'text-fg-subtle'
                        )}
                      >
                        {opt === 'hard' ? 'Must satisfy' : 'Preference'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </FormField>

            <ConstraintConfigEditor
              type={draftType}
              config={draftConfig}
              setConfig={setDraftConfig}
            />

            <Button type="button" variant="secondary" size="sm" onClick={addDraftToTemplate}>
              <Plus className="h-3.5 w-3.5" />
              Add to template
            </Button>
          </div>

        </div>

        <DialogFooter>
          {error && (
            <p className="text-xs text-danger flex-1 sm:text-left text-center self-center">
              {error}
            </p>
          )}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} loading={submitting}>
            {template ? 'Save changes' : 'Create template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
