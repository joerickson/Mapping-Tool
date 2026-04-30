// GET /api/v1/clients/[id]/pending-uploads
//   → list batches under this client that aren't fully committed.
//     Returns one row per batch with enough info for a "Retry commit"
//     UI: status, total rows, committed counts, failure reasons,
//     timestamps, source filename.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const clientId = req.query.id as string
  if (!clientId) return res.status(400).json({ error: 'client id required' })

  const db = createAdminClient()

  // Anything that's not fully committed: validation finished but commit
  // never ran, OR commit ran but had failures.
  const { data: batches, error } = await db
    .from('upload_batches')
    .select(
      'upload_batch_id, source_filename, status, row_count, summary_stats, created_at, committed_at'
    )
    .eq('client_id', clientId)
    .in('status', ['completed', 'committed'])
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) return res.status(500).json({ error: error.message })

  const rows = (batches ?? []) as Array<{
    upload_batch_id: string
    source_filename: string | null
    status: string
    row_count: number | null
    summary_stats: Record<string, any> | null
    created_at: string
    committed_at: string | null
  }>
  if (rows.length === 0) {
    return res.status(200).json({ batches: [] })
  }

  // Per-batch true committed/valid counts from staged_rows. summary_stats
  // can lag (Vercel timeout cuts the function before the final write),
  // so we count staged_rows.service_location_id IS NOT NULL as the
  // source of truth for "committed". Valid rows are anything with an
  // outcome that's eligible for commit.
  const batchIds = rows.map((r) => r.upload_batch_id)
  const trueCounts = new Map<string, { valid: number; committed: number }>()
  // Total valid (eligible) rows per batch.
  {
    const { data, error: cErr } = await db
      .from('upload_staged_rows')
      .select('upload_batch_id', { count: undefined })
      .in('upload_batch_id', batchIds)
      .in('outcome', ['valid', 'corrected', 'duplicate_existing'])
    if (cErr) return res.status(500).json({ error: cErr.message })
    for (const r of (data ?? []) as Array<{ upload_batch_id: string }>) {
      const cur = trueCounts.get(r.upload_batch_id) ?? { valid: 0, committed: 0 }
      cur.valid += 1
      trueCounts.set(r.upload_batch_id, cur)
    }
  }
  // Already-committed rows per batch (have service_location_id set).
  {
    const { data, error: cErr } = await db
      .from('upload_staged_rows')
      .select('upload_batch_id')
      .in('upload_batch_id', batchIds)
      .in('outcome', ['valid', 'corrected', 'duplicate_existing'])
      .not('service_location_id', 'is', null)
    if (cErr) return res.status(500).json({ error: cErr.message })
    for (const r of (data ?? []) as Array<{ upload_batch_id: string }>) {
      const cur = trueCounts.get(r.upload_batch_id) ?? { valid: 0, committed: 0 }
      cur.committed += 1
      trueCounts.set(r.upload_batch_id, cur)
    }
  }

  const pending = rows
    .map((b) => {
      const stats = b.summary_stats ?? {}
      const failureCount = Number(stats.commit_failure_count ?? 0)
      const counts = trueCounts.get(b.upload_batch_id) ?? { valid: 0, committed: 0 }
      const validCount = counts.valid
      const committedTotal = counts.committed
      const isCompletedNeverCommitted = b.status === 'completed' && validCount > 0
      const isCommittedWithFailures = b.status === 'committed' && failureCount > 0
      const isCommittedShortOfValid =
        b.status === 'committed' && validCount > 0 && committedTotal < validCount
      if (!(isCompletedNeverCommitted || isCommittedWithFailures || isCommittedShortOfValid)) {
        return null
      }
      return {
        batch_id: b.upload_batch_id,
        source_filename: b.source_filename ?? null,
        status: b.status,
        row_count: b.row_count ?? 0,
        valid_count: validCount,
        committed_count: committedTotal,
        failure_count: failureCount,
        failure_reasons: Array.isArray(stats.commit_failures)
          ? stats.commit_failures.slice(0, 3).map((f: any) => f.reason).filter(Boolean)
          : [],
        created_at: b.created_at,
        committed_at: b.committed_at,
        reason: isCompletedNeverCommitted
          ? 'never_committed'
          : isCommittedWithFailures
            ? 'commit_failed_rows'
            : 'commit_short_of_valid',
      }
    })
    .filter((r): r is NonNullable<typeof r> => r != null)

  return res.status(200).json({ batches: pending })
}
