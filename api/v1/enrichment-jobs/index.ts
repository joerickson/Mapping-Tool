import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'
import { runEnrichmentJob } from '../../../src/lib/enrichment/orchestrator.js'
import { parcelLookup } from '../../../src/lib/parcel/lookup.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const db = createAdminClient()

  if (req.method === 'POST') {
    const { property_ids, job_type = 'full' } = req.body ?? {}
    if (!property_ids?.length) return res.status(400).json({ error: 'property_ids required' })

    const VALID_JOB_TYPES = ['full', 'geocode', 'places', 'parcel', 'ai_classify']
    if (!VALID_JOB_TYPES.includes(job_type)) {
      return res
        .status(400)
        .json({ error: `job_type must be one of: ${VALID_JOB_TYPES.join(', ')}` })
    }

    await db
      .from('properties')
      .update({ enrichment_status: 'pending', enrichment_errors: null })
      .in('id', property_ids)

    const { data: job, error: jobErr } = await db
      .from('enrichment_jobs')
      .insert({
        property_ids,
        job_type,
        status: 'queued',
        total_properties: property_ids.length,
        processed_properties: 0,
        api_calls: {},
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
          parcelLookupFn: (propertyId, lat, lng) =>
            parcelLookup(lat, lng, {
              db,
              regridApiKey: process.env.REGRID_API_KEY ?? '',
              propertyId,
            }),
          supabaseUpdate: async (id, data) => {
            await db.from('properties').update(data).eq('id', id)
          },
          supabaseGet: async (id) => {
            const { data } = await db
              .from('properties')
              .select('*')
              .eq('id', id)
              .single()
            return data ? { ...(data as any), property_id: (data as any).id } : data
          },
          getCategories: async () => {
            const { data } = await db.from('rbm_categories').select('*')
            return data ?? []
          },
          updateJobProgress: async (jid, processed, cost, apiCallsDelta) => {
            if (apiCallsDelta) {
              const { data: current } = await db
                .from('enrichment_jobs')
                .select('api_calls, estimated_cost_usd')
                .eq('enrichment_job_id', jid)
                .single()
              const existing: Record<string, number> = (current?.api_calls as Record<string, number>) ?? {}
              const merged: Record<string, number> = { ...existing }
              for (const [k, v] of Object.entries(apiCallsDelta)) {
                merged[k] = (merged[k] ?? 0) + v
              }
              await db
                .from('enrichment_jobs')
                .update({
                  processed_properties: processed,
                  estimated_cost_usd: (current?.estimated_cost_usd ?? 0) + cost,
                  api_calls: merged,
                })
                .eq('enrichment_job_id', jid)
            } else {
              await db
                .from('enrichment_jobs')
                .update({ processed_properties: processed, estimated_cost_usd: cost })
                .eq('enrichment_job_id', jid)
            }
          },
        })

        await db
          .from('enrichment_jobs')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('enrichment_job_id', jobId)
      } catch {
        await db.from('enrichment_jobs').update({ status: 'failed' }).eq('enrichment_job_id', jobId)
      }
    })()

    return res.status(202).json({ job_id: jobId, status: 'queued' })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
