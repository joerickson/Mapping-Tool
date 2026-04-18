import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase'
import { verifyAuth, unauthorized } from '../../_lib/auth'
import { runEnrichmentJob } from '../../../src/lib/enrichment/orchestrator'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  const auth = await verifyAuth(req)
  if (!auth.ok) return unauthorized(res, auth.error)

  const db = createAdminClient()

  if (req.method === 'GET') {
    const { job_id } = req.query
    if (!job_id) return res.status(400).json({ error: 'job_id required' })

    const { data, error } = await db
      .from('enrichment_jobs')
      .select('*')
      .eq('enrichment_job_id', job_id)
      .single()

    if (error || !data) return res.status(404).json({ error: 'Not found' })
    return res.status(200).json(data)
  }

  if (req.method === 'POST') {
    const { property_ids } = req.body ?? {}
    if (!property_ids?.length) return res.status(400).json({ error: 'property_ids required' })

    // Reset enrichment status for re-enrichment
    await db
      .from('properties')
      .update({ enrichment_status: 'pending', enrichment_errors: null })
      .in('property_id', property_ids)

    const { data: job, error: jobErr } = await db
      .from('enrichment_jobs')
      .insert({
        property_ids,
        status: 'queued',
        total_properties: property_ids.length,
        processed_properties: 0,
      })
      .select('enrichment_job_id')
      .single()

    if (jobErr) return res.status(500).json({ error: jobErr.message })

    const jobId = job.enrichment_job_id

    ;(async () => {
      try {
        await db
          .from('enrichment_jobs')
          .update({ status: 'running', started_at: new Date().toISOString() })
          .eq('enrichment_job_id', jobId)

        await runEnrichmentJob(jobId, property_ids, {
          googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY!,
          anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
          regridApiKey: process.env.REGRID_API_KEY!,
          supabaseUpdate: async (id, data) => {
            await db.from('properties').update(data).eq('property_id', id)
          },
          supabaseGet: async (id) => {
            const { data } = await db.from('properties').select('*').eq('property_id', id).single()
            return data
          },
          getCategories: async () => {
            const { data } = await db.from('rbm_categories').select('*')
            return data ?? []
          },
          updateJobProgress: async (jid, processed, cost) => {
            await db
              .from('enrichment_jobs')
              .update({ processed_properties: processed, estimated_cost_usd: cost })
              .eq('enrichment_job_id', jid)
          },
        })

        await db
          .from('enrichment_jobs')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('enrichment_job_id', jobId)
      } catch (err) {
        await db
          .from('enrichment_jobs')
          .update({ status: 'failed' })
          .eq('enrichment_job_id', jobId)
      }
    })()

    return res.status(202).json({ jobId, status: 'queued' })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
