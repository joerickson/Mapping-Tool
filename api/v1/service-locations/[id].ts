import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'
import { fireWebhook } from '../../_lib/webhooks.js'
import { recordEdits } from '../../_lib/property-audit.js'
import {
  SERVICE_LOCATION_FIELDS,
  isEditableServiceLocationField,
} from '../../../src/lib/editable-fields.js'
import {
  determineCascadingEffects,
  applyCascadingEffects,
  type FieldChange,
} from '../../_lib/analysis/edit-cascade.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  let ctx: Awaited<ReturnType<typeof authenticateRequest>>
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const { id } = req.query
  const slId = id as string
  const db = createAdminClient()

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('service_locations')
      .select('*, property:properties(*)')
      .eq('id', slId)
      .single()

    if (error || !data) return res.status(404).json({ error: 'Not found' })

    const sl: any = data
    const aliasedSl = { ...sl, service_location_id: sl.id }
    const aliasedProperty = sl.property
      ? { ...sl.property, property_id: sl.property.id }
      : null
    return res.status(200).json({ service_location: aliasedSl, property: aliasedProperty })
  }

  if (req.method === 'PATCH') {
    const body = (req.body ?? {}) as Record<string, unknown>
    const editReason =
      typeof body.edit_reason === 'string' && body.edit_reason.trim().length > 0
        ? body.edit_reason.trim()
        : null

    const updates: Record<string, unknown> = {}
    const rejected: string[] = []
    for (const [k, v] of Object.entries(body)) {
      if (k === 'edit_reason') continue
      if (isEditableServiceLocationField(k)) {
        // Phase 3.8 — empty string on the size-class override means "use
        // auto-computed", which the DB stores as NULL.
        if (k === 'building_size_class_override' && v === '') {
          updates[k] = null
        } else {
          updates[k] = v
        }
      } else rejected.push(k)
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        error: 'No editable fields in body',
        editable: SERVICE_LOCATION_FIELDS.map((f) => f.key),
        rejected,
      })
    }

    const { data: current, error: fetchErr } = await db
      .from('service_locations')
      .select('*')
      .eq('id', slId)
      .single()

    if (fetchErr || !current) return res.status(404).json({ error: 'Not found' })

    const { data: updated, error: updateErr } = await db
      .from('service_locations')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', slId)
      .select('*')
      .single()

    if (updateErr) return res.status(500).json({ error: updateErr.message })

    const cur = current as any
    const upd = updated as any

    // Phase 4b — centralized cascade: figure out which downstream modules
    // should flip stale and whether to kick synthesis. Computed from the
    // diff so we can record the same effects payload on each audit row.
    const fieldChanges: FieldChange[] = Object.keys(updates)
      .filter((k) => !deepEqual(cur[k], upd[k]))
      .map((k) => ({ field: k, old: cur[k], new: upd[k] }))
    const effects = determineCascadingEffects('service_location', fieldChanges)

    const changed = await recordEdits(
      db,
      {
        propertyId: cur.property_id,
        serviceLocationId: slId,
        accountId: cur.account_id ?? null,
        clientId: cur.client_id ?? null,
      },
      cur,
      upd,
      Object.keys(updates),
      {
        changedBy: ctx.email ?? ctx.userId ?? null,
        reason: editReason,
        cascadingEffects: fieldChanges.length > 0 ? effects : null,
      }
    )

    let cascadeApplied: { staled: string[]; synthesis_triggered: boolean } = {
      staled: [],
      synthesis_triggered: false,
    }
    if (cur.account_id && cur.client_id && effects.analyses_to_stale.length > 0) {
      cascadeApplied = await applyCascadingEffects(db, effects, {
        account_id: cur.account_id,
        client_id: cur.client_id,
        property_id: cur.property_id,
      })
    }

    if (effects.comparables_invalidate && cur.property_id) {
      // Phase 4b — clear the property's comparables cache so the next view
      // recomputes against the new offering.
      await db
        .from('property_comparables')
        .delete()
        .eq('property_id', cur.property_id)
        .then(null, (err: { message: string }) =>
          console.error('[edit-cascade] comparables clear failed:', err.message)
        )
    }

    // Existing webhook (preserved from prior implementation).
    if (changed.includes('status')) {
      await fireWebhook('service_location.status_changed', {
        service_location_id: slId,
        old_status: cur.status,
        new_status: upd.status,
      })
    }

    const aliasedSl = { ...upd, service_location_id: upd.id }
    return res.status(200).json({
      service_location: aliasedSl,
      changed_fields: changed,
      rejected_fields: rejected,
      cascading_effects: {
        analyses_marked_stale: cascadeApplied.staled,
        synthesis_refresh_triggered: cascadeApplied.synthesis_triggered,
        comparables_invalidated: effects.comparables_invalidate,
        reasons: effects.reasons,
      },
      edits_recorded: changed.length,
    })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return a == null && b == null
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
    return true
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a as object)
    const bk = Object.keys(b as object)
    if (ak.length !== bk.length) return false
    for (const k of ak) {
      if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
    }
    return true
  }
  return false
}
