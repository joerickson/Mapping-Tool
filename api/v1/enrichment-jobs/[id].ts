import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase'
import { authenticateRequest } from '../../_lib/auth'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const db = createAdminClient()
  const { id } = req.query

  const { data, error } = await db
    .from('enrichment_jobs')
    .select('*')
    .eq('enrichment_job_id', String(id))
    .single()

  if (error || !data) return res.status(404).json({ error: 'Enrichment job not found' })

  return res.status(200).json({
    job_id: data.enrichment_job_id,
    status: data.status,
    job_type: data.job_type ?? 'full',
    total_properties: data.total_properties,
    processed_properties: data.processed_properties,
    estimated_cost_usd: data.estimated_cost_usd,
    errors: data.enrichment_errors ?? null,
    started_at: data.started_at,
    completed_at: data.completed_at,
    created_at: data.created_at,
  })
}
