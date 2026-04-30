// POST /api/v1/properties/bulk-reassign-branch
// Phase 3.9a — bulk-update properties.branch_override for N properties
// in one round-trip. Used by the Branch Allocation panel in Crew
// Strategy. Records audit entries (one per property) and stales the
// downstream analyses (crew_strategy + bid_pricing) via the existing
// edit cascade.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'
import { recordEdits } from '../../_lib/property-audit.js'
import {
  determineCascadingEffects,
  applyCascadingEffects,
  type FieldChange,
} from '../../_lib/analysis/edit-cascade.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let ctx: Awaited<ReturnType<typeof authenticateRequest>>
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const body = (req.body ?? {}) as Record<string, unknown>
  const propertyIds = Array.isArray(body.property_ids)
    ? (body.property_ids as unknown[]).filter((x): x is string => typeof x === 'string')
    : []
  // null / '' clears the override (revert to nearest-branch auto-assign).
  const branchName =
    body.branch_name == null || body.branch_name === ''
      ? null
      : typeof body.branch_name === 'string'
        ? body.branch_name.trim()
        : null
  const editReason =
    typeof body.edit_reason === 'string' && body.edit_reason.trim().length > 0
      ? body.edit_reason.trim()
      : `Bulk branch reassignment${branchName ? ` to ${branchName}` : ' (cleared)'}`

  if (propertyIds.length === 0) {
    return res.status(400).json({ error: 'property_ids must be a non-empty array of UUIDs' })
  }
  if (propertyIds.length > 5000) {
    return res.status(400).json({ error: 'Cannot reassign more than 5000 properties at once' })
  }

  const db = createAdminClient()

  // Fetch current state for diffing + audit + cascade scoping.
  const { data: currentRows, error: fetchErr } = await db
    .from('properties')
    .select('id, branch_override, account_id, latitude, longitude')
    .in('id', propertyIds)
  if (fetchErr) return res.status(500).json({ error: fetchErr.message })
  const current = (currentRows ?? []) as Array<{
    id: string
    branch_override: string | null
    account_id: string | null
    latitude: number | null
    longitude: number | null
  }>
  if (current.length === 0) {
    return res.status(404).json({ error: 'No matching properties found' })
  }

  const accountIds = new Set(current.map((r) => r.account_id).filter(Boolean) as string[])

  const now = new Date().toISOString()
  const changedBy = ctx.email ?? ctx.userId ?? null

  const { error: updateErr } = await db
    .from('properties')
    .update({
      branch_override: branchName,
      branch_override_changed_at: now,
      branch_override_changed_by: changedBy,
      updated_at: now,
    })
    .in('id', propertyIds)
  if (updateErr) return res.status(500).json({ error: updateErr.message })

  // Audit + cascade per property. Batch the cascade by (account_id,
  // client_id) using the unique pairs from the affected SLs.
  const { data: slRows } = await db
    .from('service_locations')
    .select('property_id, account_id, client_id')
    .in('property_id', propertyIds)
  const cascadeKeys = new Map<string, { account_id: string; client_id: string }>()
  for (const sl of (slRows ?? []) as any[]) {
    if (sl.account_id && sl.client_id) {
      cascadeKeys.set(`${sl.account_id}:${sl.client_id}`, {
        account_id: sl.account_id,
        client_id: sl.client_id,
      })
    }
  }

  const fieldChanges: FieldChange[] = [
    { field: 'branch_override', old: '<varies>', new: branchName },
  ]
  const effects = determineCascadingEffects('property', fieldChanges)

  let totalChanged = 0
  for (const cur of current) {
    if (cur.branch_override === branchName) continue
    const updatedRow = { ...cur, branch_override: branchName }
    const changed = await recordEdits(
      db,
      {
        propertyId: cur.id,
        accountId: cur.account_id ?? null,
        clientId: null,
      },
      cur as any,
      updatedRow as any,
      ['branch_override'],
      {
        changedBy,
        reason: editReason,
        cascadingEffects: effects,
      }
    )
    if (changed.length > 0) totalChanged++
  }

  let staledModuleKeys: string[] = []
  let synthesisTriggered = false
  if (effects.analyses_to_stale.length > 0 && cascadeKeys.size > 0) {
    for (const { account_id, client_id } of cascadeKeys.values()) {
      const applied = await applyCascadingEffects(db, effects, { account_id, client_id })
      staledModuleKeys = Array.from(new Set([...staledModuleKeys, ...applied.staled]))
      synthesisTriggered = synthesisTriggered || applied.synthesis_triggered
    }
  }

  return res.status(200).json({
    properties_updated: current.length,
    properties_audited: totalChanged,
    branch_name: branchName,
    accounts_affected: Array.from(accountIds),
    cascading_effects: {
      analyses_marked_stale: staledModuleKeys,
      synthesis_refresh_triggered: synthesisTriggered,
    },
  })
}
