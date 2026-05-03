// PATCH /api/v1/schedule-assessments/[id]/hybrid
//
// Update the operator's per-row choice on the diff. Body:
//   { rows: [{ key: "<sl_id>|<idx>", source: "current"|"optimized"|"skip" }] }
// Stored on the assessment's hybrid_overrides jsonb. The save-as-template
// endpoint reads this map to decide which dates/crews to lock when
// promoting the hybrid to a new routing template.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' })
  try { await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const id = req.query.id as string
  const body = (req.body ?? {}) as {
    rows?: Array<{ key: string; source: 'current' | 'optimized' | 'skip' | null }>
  }
  if (!Array.isArray(body.rows)) return res.status(400).json({ error: 'rows array required' })
  const db = createAdminClient()

  const { data: row } = await db
    .from('schedule_assessments')
    .select('hybrid_overrides')
    .eq('id', id)
    .maybeSingle()
  if (!row) return res.status(404).json({ error: 'Assessment not found' })

  const next = { ...((row as any).hybrid_overrides ?? {}) } as Record<string, { source: string }>
  const VALID = new Set(['current', 'optimized', 'skip'])
  for (const r of body.rows) {
    if (!r.key) continue
    if (r.source == null) {
      delete next[r.key]
    } else if (VALID.has(r.source)) {
      next[r.key] = { source: r.source }
    }
  }
  const { error } = await db
    .from('schedule_assessments')
    .update({ hybrid_overrides: next, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ hybrid_overrides: next })
}
