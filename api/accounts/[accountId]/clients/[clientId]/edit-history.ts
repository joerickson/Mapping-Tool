// GET /api/accounts/[accountId]/clients/[clientId]/edit-history
// Audit log scoped to one tenant. Powers the admin audit page.
//
// Filters (all optional, query string):
//   entity_type=property|service_location
//   field_name=<exact match>
//   edited_by=<email or substring>
//   date_from=<ISO>  date_to=<ISO>
//   has_cascading_effects=true|false
//   page=<int, 1-based>  limit=<int, default 50, max 200>
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../../_lib/supabase.js'
import { authenticateRequest } from '../../../../_lib/auth.js'

export const config = { maxDuration: 15 }

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const accountId = req.query.accountId as string
  const clientId = req.query.clientId as string
  if (!accountId || !clientId) {
    return res.status(400).json({ error: 'accountId and clientId required' })
  }

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(String(req.query.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
  )
  const page = Math.max(1, parseInt(String(req.query.page ?? 1), 10) || 1)
  const offset = (page - 1) * limit

  const db = createAdminClient()

  // Phase 4a's table uses property_id + service_location_id columns
  // rather than entity_type/entity_id, so derive the discriminator on
  // the way out. service_location_id IS NULL → 'property' edit.
  let query = db
    .from('property_edit_history')
    .select('*', { count: 'exact' })
    .eq('account_id', accountId)
    .eq('client_id', clientId)
    .order('changed_at', { ascending: false })

  const entityType = req.query.entity_type as string | undefined
  if (entityType === 'service_location') {
    query = query.not('service_location_id', 'is', null)
  } else if (entityType === 'property') {
    query = query.is('service_location_id', null)
  }

  const fieldName = req.query.field_name as string | undefined
  if (fieldName) query = query.eq('field_name', fieldName)

  const editedBy = req.query.edited_by as string | undefined
  if (editedBy) query = query.ilike('changed_by', `%${editedBy}%`)

  const dateFrom = req.query.date_from as string | undefined
  if (dateFrom) query = query.gte('changed_at', dateFrom)
  const dateTo = req.query.date_to as string | undefined
  if (dateTo) query = query.lte('changed_at', dateTo)

  const hasCascading = req.query.has_cascading_effects as string | undefined
  if (hasCascading === 'true') query = query.not('cascading_effects', 'is', null)
  else if (hasCascading === 'false') query = query.is('cascading_effects', null)

  const { data, count, error } = await query.range(offset, offset + limit - 1)

  if (error) return res.status(500).json({ error: error.message })

  const edits = (data ?? []).map((r: any) => ({
    id: r.id,
    entity_type: r.service_location_id ? 'service_location' : 'property',
    entity_id: r.service_location_id ?? r.property_id,
    property_id: r.property_id,
    service_location_id: r.service_location_id,
    field_name: r.field_name,
    old_value: r.old_value,
    new_value: r.new_value,
    edited_by: r.changed_by,
    edited_at: r.changed_at,
    reason: r.reason ?? null,
    cascading_effects: r.cascading_effects ?? null,
  }))

  return res.status(200).json({
    edits,
    total_count: count ?? 0,
    page,
    limit,
    has_more: (count ?? 0) > offset + edits.length,
  })
}
