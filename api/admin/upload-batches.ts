import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../_lib/supabase.js'
import { authenticateRequest } from '../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string }
    return res.status(e.statusCode ?? 401).json({ error: e.message ?? 'Unauthorized' })
  }

  const db = createAdminClient()

  const { data: batches, error } = await db
    .from('upload_batches')
    .select('upload_batch_id, source_filename, status, total_rows, rows_processed, errors_count, summary_stats, created_at, committed_at, account_id, client_id')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return res.status(500).json({ error: error.message })

  const rows = batches ?? []
  const accountIds = [...new Set(rows.map((b: any) => b.account_id).filter(Boolean))]
  const clientIds = [...new Set(rows.map((b: any) => b.client_id).filter(Boolean))]

  const [{ data: accounts }, { data: clients }] = await Promise.all([
    accountIds.length > 0
      ? db.from('accounts').select('id, name').in('id', accountIds)
      : Promise.resolve({ data: [] }),
    clientIds.length > 0
      ? db.from('clients').select('id, name').in('id', clientIds)
      : Promise.resolve({ data: [] }),
  ])

  const accountMap = Object.fromEntries((accounts ?? []).map((a: any) => [a.id, a.name]))
  const clientMap = Object.fromEntries((clients ?? []).map((c: any) => [c.id, c.name]))

  const result = rows.map((b: any) => ({
    ...b,
    account_name: accountMap[b.account_id] ?? null,
    client_name: clientMap[b.client_id] ?? null,
  }))

  return res.status(200).json({ batches: result })
}
