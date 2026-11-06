import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { requireAdmin } from '../../../_lib/auth-roles.js'

// Must mirror the table list in move_client_to_account (migration 20261106161317).
const MOVED_TABLES = [
  'service_locations', 'service_offerings', 'service_location_constraints',
  'service_location_constraint_templates', 'account_operational_constraints',
  'analysis_scenarios', 'analysis_chat_messages', 'portfolio_analyses',
  'routing_templates', 'day_schedules', 'manual_trips',
  'overnight_cluster_overrides', 'crew_vehicles', 'custom_field_definitions',
  'service_line_pricing_config', 'property_edit_history',
  'addon_cohort_assignments', 'upload_batches', 'schedule_assessments',
] as const

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let userId: string | undefined
  try {
    const { ctx } = await requireAdmin(req)
    userId = ctx.userId ?? undefined
  } catch (err: any) {
    return res.status(err.statusCode ?? 403).json({ error: err.message ?? 'Forbidden' })
  }

  const clientId = req.query.id as string
  const body = (req.body ?? {}) as Record<string, unknown>
  const targetAccountId = typeof body.target_account_id === 'string' ? body.target_account_id : ''
  const newName = typeof body.new_name === 'string' ? body.new_name : null
  if (!clientId) return res.status(400).json({ error: 'client id is required' })
  if (!targetAccountId) return res.status(400).json({ error: 'target_account_id is required' })

  const db = createAdminClient()
  const { data, error } = await db.rpc('move_client_to_account', {
    p_client_id: clientId,
    p_target_account_id: targetAccountId,
    p_new_name: newName,
    p_moved_by: userId ?? null,
  })

  if (error) {
    const msg = `${error.message ?? ''}`
    if (msg.includes('name_conflict')) {
      return res.status(409).json({ error: 'name_conflict', conflicting_name: error.details ?? null })
    }
    if (msg.includes('invalid_target_account')) {
      return res.status(400).json({ error: 'invalid_target_account' })
    }
    if (msg.includes('client_not_found')) {
      return res.status(404).json({ error: 'client_not_found' })
    }
    // Malformed uuid etc. (SQLSTATE 22P02)
    if (error.code === '22P02') return res.status(400).json({ error: 'invalid_uuid' })
    return res.status(500).json({ error: error.message })
  }

  const result = data as {
    moved: boolean
    from_account_id: string
    to_account_id: string
    final_name: string
    row_counts: Record<string, number>
  }

  // Post-commit straggler check: rows still carrying the old account_id for
  // this client (e.g. inserted by a concurrent writer). Surfaced, not an error.
  let stragglers = 0
  if (result.moved) {
    const counts = await Promise.all(
      MOVED_TABLES.map(async (table) => {
        const { count, error: cErr } = await db
          .from(table)
          .select('*', { count: 'exact', head: true })
          .eq('account_id', result.from_account_id)
          .eq('client_id', clientId)
        return cErr ? 0 : count ?? 0
      }),
    )
    stragglers = counts.reduce((a, b) => a + b, 0)
  }

  return res.status(200).json({ ...result, stragglers })
}
