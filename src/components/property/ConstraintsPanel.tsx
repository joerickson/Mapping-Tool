// Service-location constraints panel. Sits on PropertyDetail between the
// Risk Assessment card and Comparable Properties.
//
// Shows all constraints for the property, grouped by service location.
// Edit-in-place isn't supported in PR1 — delete + re-add is the workflow.
import { useEffect, useState, useCallback } from 'react'
import { Trash2, Plus } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import Button from '../ui/Button'
import { Badge } from '../ui/Badge'
import { Card, CardTitle, CardDescription } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { cn } from '../../lib/cn'
import AddConstraintDialog from './AddConstraintDialog'
import { CONSTRAINT_LABELS, type ConstraintType } from './constraint-types'
import type { ServiceLocation } from '../../types'

export interface ConstraintRow {
  id: string
  service_location_id: string
  constraint_type: ConstraintType
  enforcement: 'hard' | 'soft'
  config: Record<string, unknown>
  notes: string | null
  created_at: string
  created_by: string | null
}

interface Props {
  serviceLocations: ServiceLocation[]
}

export default function ConstraintsPanel({ serviceLocations }: Props) {
  const { getToken } = useAuth()
  const [rowsBySl, setRowsBySl] = useState<Record<string, ConstraintRow[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    if (serviceLocations.length === 0) {
      setRowsBySl({})
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      const fetched = await Promise.all(
        serviceLocations.map(async (sl) => {
          const res = await fetch(
            `/api/service-locations/${sl.service_location_id}/constraints`,
            { headers: { Authorization: `Bearer ${token}` } }
          )
          if (!res.ok) throw new Error(`Failed to load constraints (${res.status})`)
          const json = (await res.json()) as { constraints: ConstraintRow[] }
          return [sl.service_location_id, json.constraints] as const
        })
      )
      const map: Record<string, ConstraintRow[]> = {}
      for (const [slId, rows] of fetched) map[slId] = rows
      setRowsBySl(map)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [serviceLocations, getToken])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  async function handleDelete(slId: string, constraintId: string) {
    setDeletingId(constraintId)
    try {
      const token = await getToken()
      const res = await fetch(
        `/api/service-locations/${slId}/constraints/${constraintId}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Delete failed (${res.status})`)
      }
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeletingId(null)
    }
  }

  const totalCount = Object.values(rowsBySl).reduce((n, rows) => n + rows.length, 0)

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>Service constraints</CardTitle>
          <CardDescription>
            Schedule, access, and operational rules attached to each service location.
          </CardDescription>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setDialogOpen(true)}
          disabled={serviceLocations.length === 0}
        >
          <Plus className="h-3.5 w-3.5" />
          Add constraint
        </Button>
      </div>

      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-fg-muted">Loading constraints…</p>
        ) : error ? (
          <p className="text-sm text-danger">Error: {error}</p>
        ) : serviceLocations.length === 0 ? (
          <EmptyState
            title="No service locations"
            description="Constraints attach to service locations. Add one to this property first."
          />
        ) : totalCount === 0 ? (
          <p className="text-sm text-fg-muted">
            No constraints yet. Click <span className="font-medium text-fg">Add constraint</span> to define schedule,
            access, or operational rules for this property's service locations.
          </p>
        ) : (
          <div className="space-y-4">
            {serviceLocations.map((sl) => {
              const rows = rowsBySl[sl.service_location_id] ?? []
              if (rows.length === 0) return null
              return (
                <div key={sl.service_location_id}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle mb-2">
                    {sl.display_name ?? sl.service_location_id}
                  </p>
                  <ul className="space-y-2">
                    {rows.map((r) => (
                      <li
                        key={r.id}
                        className={cn(
                          'rounded-md border-l-2 bg-surface-subtle px-3 py-2 text-sm',
                          r.enforcement === 'hard' ? 'border-accent' : 'border-fg-subtle'
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-fg">
                                {CONSTRAINT_LABELS[r.constraint_type] ?? r.constraint_type}
                              </span>
                              <Badge variant={r.enforcement === 'hard' ? 'accent' : 'outline'}>
                                {r.enforcement}
                              </Badge>
                            </div>
                            <p className="mt-0.5 text-xs text-fg-muted">
                              {summarizeConfig(r.constraint_type, r.config)}
                            </p>
                            {r.notes && (
                              <p className="mt-1 text-xs text-fg-subtle italic">{r.notes}</p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDelete(sl.service_location_id, r.id)}
                            disabled={deletingId === r.id}
                            className="text-fg-subtle hover:text-danger transition-colors disabled:opacity-50"
                            aria-label="Delete constraint"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <AddConstraintDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        serviceLocations={serviceLocations}
        onCreated={() => {
          setDialogOpen(false)
          loadAll()
        }}
      />
    </Card>
  )
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function summarizeConfig(type: ConstraintType, c: Record<string, unknown>): string {
  switch (type) {
    case 'day_of_week': {
      const days = (c.allowed_days as number[] | undefined) ?? []
      if (days.length === 7) return 'All days allowed'
      return `Allowed: ${days.map((d) => DAY_NAMES[d]).join(', ')}`
    }
    case 'blackout_dates': {
      const dates = (c.dates as string[] | undefined) ?? []
      if (dates.length <= 3) return `Blackout: ${dates.join(', ')}`
      return `Blackout: ${dates.slice(0, 3).join(', ')} +${dates.length - 3} more`
    }
    case 'seasonal_window': {
      const sm = c.start_month as number
      const em = c.end_month as number
      return `${MONTH_NAMES[sm - 1]}–${MONTH_NAMES[em - 1]}`
    }
    case 'time_window': {
      return `${c.earliest_start}–${c.latest_end}`
    }
    case 'access_requirement': {
      const details = c.details ? ` (${c.details})` : ''
      return `${c.kind}${details}`
    }
    case 'contact_requirement': {
      const parts: string[] = []
      if (c.contact_name) parts.push(`Contact: ${c.contact_name}`)
      if (c.contact_phone) parts.push(`${c.contact_phone}`)
      if (c.advance_notice_hours != null) parts.push(`${c.advance_notice_hours}h notice`)
      if (c.instructions) parts.push(`"${c.instructions}"`)
      return parts.join(' · ')
    }
  }
}
