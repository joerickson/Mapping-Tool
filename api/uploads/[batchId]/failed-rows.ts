import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string }
    return res.status(e.statusCode ?? 401).json({ error: e.message ?? 'Unauthorized' })
  }

  const batchId = req.query.batchId as string
  const db = createAdminClient()

  const { data: batch, error: batchErr } = await db
    .from('upload_batches')
    .select('upload_batch_id, summary_stats')
    .eq('upload_batch_id', batchId)
    .single()
  if (batchErr || !batch) return res.status(404).json({ error: 'Batch not found' })

  // Failed rows = committable rows that have not landed yet. Querying directly
  // (rather than trusting summary_stats.commit_failures, which is capped at 50)
  // surfaces ALL pending rows.
  const { data: rows, error } = await db
    .from('upload_staged_rows')
    .select('id, sheet_name, row_index, property_data, service_location_data, service_offering_id')
    .eq('upload_batch_id', batchId)
    .in('outcome', ['valid', 'corrected', 'duplicate_existing'])
    .is('service_location_id', null)
    .order('sheet_name')
    .order('row_index')

  if (error) return res.status(500).json({ error: error.message })

  const reasonById = new Map<string, string>()
  const failures = (batch.summary_stats as { commit_failures?: Array<{ staged_row_id: string; reason: string }> } | null)
    ?.commit_failures
  for (const f of failures ?? []) reasonById.set(f.staged_row_id, f.reason)

  const result = (rows ?? []).map((r) => ({
    id: r.id as string,
    sheet_name: r.sheet_name as string,
    row_index: r.row_index as number,
    property_data: (r.property_data as Record<string, unknown>) ?? {},
    service_location_data: (r.service_location_data as Record<string, unknown>) ?? {},
    service_offering_id: (r.service_offering_id as string | null) ?? null,
    reason: reasonById.get(r.id as string) ?? null,
  }))

  return res.status(200).json({ rows: result, count: result.length })
}
