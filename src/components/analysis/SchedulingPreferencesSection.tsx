// Phase 4.3 — Scheduling preferences section. Lets the operator set the
// cluster radius (miles) and the same-day pairing rules (drive minutes,
// combined sqft cap, max stops/day). Writes scheduling_preferences jsonb
// through the same /operational-constraints PUT used by other sections.
import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import Button from '../ui/Button'
import { Input } from '../ui/Input'

export interface SchedulingPreferences {
  cluster_radius_miles: number
  pairing_max_drive_minutes: number
  pairing_max_combined_sqft: number
  pairing_max_buildings_per_day: number
}

const DEFAULTS: SchedulingPreferences = {
  cluster_radius_miles: 30,
  pairing_max_drive_minutes: 30,
  pairing_max_combined_sqft: 20000,
  pairing_max_buildings_per_day: 2,
}

const FIELDS: Array<{
  key: keyof SchedulingPreferences
  label: string
  helper: string
  format: (n: number) => string
}> = [
  {
    key: 'cluster_radius_miles',
    label: 'Cluster radius (miles)',
    helper:
      'Properties within this radius get scheduled together as one trip / contiguous block.',
    format: (n) => `${n} mi`,
  },
  {
    key: 'pairing_max_drive_minutes',
    label: 'Same-day pairing — max drive between stops (min)',
    helper:
      'Two buildings can share a day only if within this drive time of each other.',
    format: (n) => `${n} min`,
  },
  {
    key: 'pairing_max_combined_sqft',
    label: 'Same-day pairing — max combined sq ft',
    helper:
      'Two buildings can share a day only if their summed serviceable sq ft is at or below this cap.',
    format: (n) => `${n.toLocaleString()} sq ft`,
  },
  {
    key: 'pairing_max_buildings_per_day',
    label: 'Hard cap on stops per crew day',
    helper:
      'Setup/breakdown overhead — crews rarely fit more than this many properties in a day.',
    format: (n) => `${n}`,
  },
]

interface Props {
  accountId: string
  clientId: string
  config: SchedulingPreferences
  constraintsRow: any
  onSaved: () => void
}

export default function SchedulingPreferencesSection({
  accountId,
  clientId,
  config,
  constraintsRow,
  onSaved,
}: Props) {
  const { getToken } = useAuth()
  const [editingKey, setEditingKey] = useState<keyof SchedulingPreferences | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function saveConstraint(patch: Record<string, unknown>) {
    setSaving(true)
    setError(null)
    try {
      const token = await getToken()
      // Mirror OvernightLodgingSection: pass through fields the PUT endpoint
      // expects so unrelated values don't get nulled by the upsert.
      const payload: Record<string, unknown> = {
        client_id: (constraintsRow as any).client_id ?? null,
        existing_branches: (constraintsRow as any).existing_branches ?? [],
        excluded_property_ids: (constraintsRow as any).excluded_property_ids ?? [],
        excluded_property_reason: (constraintsRow as any).excluded_property_reason ?? null,
        population_constraint: (constraintsRow as any).population_constraint ?? undefined,
        utilization_constraint: (constraintsRow as any).utilization_constraint ?? undefined,
        ...patch,
      }
      const res = await fetch(
        `/api/accounts/${accountId}/clients/${clientId}/operational-constraints`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        }
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as any).error ?? `HTTP ${res.status}`)
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
      setEditingKey(null)
      setEditValue('')
    }
  }

  function commitEdit() {
    if (editingKey == null) return
    const n = Number(editValue.trim())
    if (!Number.isFinite(n) || n < 0) {
      setError('Enter a non-negative number.')
      return
    }
    saveConstraint({ scheduling_preferences: { ...config, [editingKey]: n } })
  }

  return (
    <section className="space-y-3">
      <header>
        <h3 className="text-sm font-semibold text-fg">Scheduling preferences</h3>
        <p className="text-xs text-fg-muted mt-0.5">
          Drive how the routing engine groups properties geographically and
          when it pairs two properties on the same crew day. Applies to all
          new and regenerated routing templates for this client.
        </p>
      </header>

      <ul className="divide-y divide-border rounded-md border border-border bg-surface">
        {FIELDS.map((f) => {
          const value = config[f.key]
          const isEditing = editingKey === f.key
          const isDefault = value === DEFAULTS[f.key]
          return (
            <li key={f.key} className="px-3 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">{f.label}</p>
                  <p className="text-[11px] text-fg-muted mt-0.5">{f.helper}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isEditing ? (
                    <>
                      <Input
                        type="number"
                        min={0}
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEdit()
                          if (e.key === 'Escape') {
                            setEditingKey(null)
                            setEditValue('')
                          }
                        }}
                        className="w-28 h-8 text-sm"
                      />
                      <Button size="sm" onClick={commitEdit} loading={saving}>
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingKey(null)
                          setEditValue('')
                        }}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="font-tabular text-sm text-fg">
                        {f.format(value)}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingKey(f.key)
                          setEditValue(String(value))
                        }}
                      >
                        Edit
                      </Button>
                      {!isDefault && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Reset to default"
                          onClick={() =>
                            saveConstraint({
                              scheduling_preferences: { ...config, [f.key]: DEFAULTS[f.key] },
                            })
                          }
                        >
                          <RotateCcw className="h-3 w-3" />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {error && (
        <p className="text-xs text-danger border border-danger/30 bg-danger-subtle rounded-md px-2 py-1">
          {error}
        </p>
      )}
    </section>
  )
}
