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

  const pending = rows
    .map((b) => {
      const stats = b.summary_stats ?? {}
      const failureCount = Number(stats.commit_failure_count ?? 0)
      const validCount =
        Number(stats.valid ?? 0) +
        Number(stats.corrected ?? 0) +
        Number(stats.duplicate_existing ?? 0)
      const committedNew = Number(stats.committed_new_properties ?? 0)
      const committedExisting = Number(stats.committed_existing_properties ?? 0)
      const committedTotal = committedNew + committedExisting
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
