// POST /api/properties/bulk-edit
// Body: {
//   property_ids: uuid[],
//   action: 'add_tag' | 'remove_tag' | 'set_notes',
//   value: string
// }
//
// Reads each property's current state, applies the diff, persists, and
// records one audit row per property that actually changed. Properties
// already in the desired state are skipped (e.g. add_tag where the tag
// already exists) and counted as 'unchanged' so the UI can show
// "Tagged 5 of 10 (others already tagged)".
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../_lib/supabase.js'
import { authenticateRequest } from '../_lib/auth.js'
import { recordEdits } from '../_lib/property-audit.js'

export const config = { maxDuration: 30 }

const MAX_BULK = 500
type BulkAction = 'add_tag' | 'remove_tag' | 'set_notes'
const ACTIONS: BulkAction[] = ['add_tag', 'remove_tag', 'set_notes']

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let ctx: Awaited<ReturnType<typeof authenticateRequest>>
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const body = (req.body ?? {}) as Record<string, unknown>
  const propertyIds = Array.isArray(body.property_ids) ? (body.property_ids as string[]) : []
  const action = body.action as BulkAction
  const value = body.value as string | undefined

  if (propertyIds.length === 0) {
    return res.status(400).json({ error: 'property_ids must be a non-empty array' })
  }
  if (propertyIds.length > MAX_BULK) {
    return res.status(400).json({ error: `cap is ${MAX_BULK} properties per call` })
  }
  if (!ACTIONS.includes(action)) {
    return res.status(400).json({ error: `action must be one of: ${ACTIONS.join(', ')}` })
  }
  if ((action === 'add_tag' || action === 'remove_tag') && (!value || typeof value !== 'string')) {
    return res.status(400).json({ error: 'value (tag string) is required for tag actions' })
  }
  if (action === 'add_tag' && !/^[a-z0-9-]{1,50}$/i.test(value!)) {
    return res
      .status(400)
      .json({ error: 'tag must be 1–50 chars, alphanumeric + dashes' })
  }

  const db = createAdminClient()

  const { data: rows, error: fetchErr } = await db
    .from('properties')
    .select('id, account_id, client_id, internal_tags, notes')
    .in('id', propertyIds)

  if (fetchErr) return res.status(500).json({ error: fetchErr.message })
  const found = new Set((rows ?? []).map((r) => (r as { id: string }).id))
  const missing = propertyIds.filter((id) => !found.has(id))

  let updated = 0
  let unchanged = 0

  for (const r of rows ?? []) {
    const row = r as {
      id: string
      account_id: string | null
      client_id: string | null
      internal_tags: string[] | null
      notes: string | null
    }
    const oldTags = row.internal_tags ?? []
    const oldNotes = row.notes ?? null

    let newTags = oldTags
    let newNotes = oldNotes

    if (action === 'add_tag') {
      if (oldTags.includes(value!)) {
        unchanged++
        continue
      }
      newTags = [...oldTags, value!]
    } else if (action === 'remove_tag') {
      if (!oldTags.includes(value!)) {
        unchanged++
        continue
      }
      newTags = oldTags.filter((t) => t !== value)
    } else if (action === 'set_notes') {
      const next = typeof value === 'string' ? value : null
      if (next === oldNotes) {
        unchanged++
        continue
      }
      newNotes = next
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (newTags !== oldTags) patch.internal_tags = newTags
    if (newNotes !== oldNotes) patch.notes = newNotes

    const { data: updatedRow, error: updateErr } = await db
      .from('properties')
      .update(patch)
      .eq('id', row.id)
      .select('id, internal_tags, notes')
      .single()

    if (updateErr) continue

    await recordEdits(
      db,
      {
        propertyId: row.id,
        accountId: row.account_id,
        clientId: row.client_id,
      },
      { internal_tags: oldTags, notes: oldNotes },
      {
        internal_tags: (updatedRow as any).internal_tags,
        notes: (updatedRow as any).notes,
      },
      newTags !== oldTags ? ['internal_tags'] : ['notes'],
      {
        changedBy: ctx.email ?? ctx.userId ?? null,
        reason: `bulk-edit: ${action}`,
      }
    )

    updated++
  }

  return res.status(200).json({
    requested: propertyIds.length,
    updated,
    unchanged,
    not_found: missing.length,
    not_found_ids: missing,
  })
}
