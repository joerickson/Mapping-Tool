// GET /api/scheduler/schedules?account_id=&client_id=&status=&date_from=&date_to=
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'

export const config = { maxDuration: 10 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const accountId = req.query.account_id as string | undefined
  const clientId = req.query.client_id as string | undefined
  if (!accountId || !clientId) {
    return res.status(400).json({ error: 'account_id and client_id required' })
  }

  const db = createAdminClient()
  let query = db
    .from('day_schedules')
    .select(
      'id, name, scheduled_date, branch_name, status, total_day_minutes, total_drive_miles, optimization_score, hard_constraint_violations, soft_constraint_violations, created_at, optimized_at'
    )
    .eq('account_id', accountId)
    .eq('client_id', clientId)
    .order('scheduled_date', { ascending: false })

  const status = req.query.status as string | undefined
  if (status) query = query.in('status', String(status).split(','))

  const dateFrom = req.query.date_from as string | undefined
  if (dateFrom) query = query.gte('scheduled_date', dateFrom)
  const dateTo = req.query.date_to as string | undefined
  if (dateTo) query = query.lte('scheduled_date', dateTo)

  const { data, error } = await query.limit(100)
  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ schedules: data ?? [] })
}
