import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'
import { fireWebhook } from '../../_lib/webhooks.js'
import { recordEdits, markCrewStrategyStale } from '../../_lib/property-audit.js'
import {
  SERVICE_LOCATION_FIELDS,
  isEditableServiceLocationField,
} from '../../../src/lib/editable-fields.js'

const SQFT_STALE_THRESHOLD = 0.1 // 10%

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

    const updates: Record<string, unknown> = {}
    const rejected: string[] = []
    for (const [k, v] of Object.entries(body)) {
      if (isEditableServiceLocationField(k)) updates[k] = v
      else rejected.push(k)
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
      { changedBy: ctx.email ?? ctx.userId ?? null }
    )

    // Side effect 1: status change webhook (existing behavior)
    if (changed.includes('status')) {
      await fireWebhook('service_location.status_changed', {
        service_location_id: slId,
        old_status: cur.status,
        new_status: upd.status,
      })
    }

    // Side effect 2: serviceable_sqft change >10% → mark Crew Strategy
    // stale so the dashboard prompts a re-run. Skip if there's no prior
    // sqft to compare against (first-time set is fine).
    let crewStrategyMarkedStale = false
    if (changed.includes('serviceable_sqft') && cur.account_id && cur.client_id) {
      const oldSqft = Number(cur.serviceable_sqft) || 0
      const newSqft = Number(upd.serviceable_sqft) || 0
      if (oldSqft > 0) {
        const delta = Math.abs(newSqft - oldSqft) / oldSqft
        if (delta >= SQFT_STALE_THRESHOLD) {
          await markCrewStrategyStale(db, cur.account_id, cur.client_id)
          crewStrategyMarkedStale = true
        }
      }
    }

    const aliasedSl = { ...upd, service_location_id: upd.id }
    return res.status(200).json({
      service_location: aliasedSl,
      changed_fields: changed,
      rejected_fields: rejected,
      crew_strategy_marked_stale: crewStrategyMarkedStale,
    })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
