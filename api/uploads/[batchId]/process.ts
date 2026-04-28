import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'

export const config = { maxDuration: 60 }

interface SheetMapping {
  sheet_name: string
  service_offering_id: string | null
  skip: boolean
}

interface ProcessBody {
  sheet_mappings: SheetMapping[]
  column_mappings: Record<string, Record<string, string>>
  save_to_template?: boolean
  client_id?: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let auth: Awaited<ReturnType<typeof authenticateRequest>>
  try {
    auth = await authenticateRequest(req)
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string }
    return res.status(e.statusCode ?? 401).json({ error: e.message ?? 'Unauthorized' })
  }

  const batchId = req.query.batchId as string
  const db = createAdminClient()

  const { data: batch, error: fetchErr } = await db
    .from('upload_batches')
    .select('upload_batch_id, status, total_rows, row_count, client_id, file_path')
    .eq('upload_batch_id', batchId)
    .single()

  if (fetchErr || !batch) return res.status(404).json({ error: 'Batch not found' })

  if (batch.status === 'processing') {
    return res.status(200).json({ batch_id: batchId, status: 'processing', message: 'Already processing' })
  }
  if (batch.status === 'committed' || batch.status === 'cancelled') {
    return res.status(400).json({ error: `Batch is already ${batch.status}` })
  }

  const body = req.body as ProcessBody
  if (!body?.sheet_mappings?.length) {
    return res.status(400).json({ error: 'sheet_mappings required' })
  }

  const processingConfig = {
    sheet_mappings: body.sheet_mappings,
    column_mappings: body.column_mappings ?? {},
    save_to_template: body.save_to_template ?? false,
  }

  // Persist config and mark as processing
  await db
    .from('upload_batches')
    .update({
      processing_config: processingConfig,
      status: 'processing',
      processing_started_at: new Date().toISOString(),
      rows_processed: 0,
    })
    .eq('upload_batch_id', batchId)

  // Save to client_templates if requested
  if (body.save_to_template && batch.client_id) {
    const clientId = batch.client_id as string
    const { data: existing } = await db
      .from('client_templates')
      .select('id, upload_column_mapping, sheet_to_offering_mapping')
      .eq('client_id', clientId)
      .maybeSingle()

    const sheetOfferingMerge = Object.fromEntries(
      body.sheet_mappings
        .filter((m) => !m.skip && m.service_offering_id)
        .map((m) => [m.sheet_name, m.service_offering_id])
    )

    if (existing) {
      await db
        .from('client_templates')
        .update({
          upload_column_mapping: { ...(existing.upload_column_mapping ?? {}), ...body.column_mappings },
          sheet_to_offering_mapping: { ...(existing.sheet_to_offering_mapping ?? {}), ...sheetOfferingMerge },
          is_configured: true,
        })
        .eq('client_id', clientId)
    } else {
      await db
        .from('client_templates')
        .insert({
          client_id: clientId,
          upload_column_mapping: body.column_mappings ?? {},
          sheet_to_offering_mapping: sheetOfferingMerge,
          is_configured: true,
        })
    }
  }

  // Fire-and-forget: trigger Supabase Edge Function
  const edgeFnUrl = `${process.env.SUPABASE_URL}/functions/v1/process-upload-batch`
  fetch(edgeFnUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ batch_id: batchId }),
  }).catch((err: Error) => {
    console.error('Edge Function trigger failed:', err.message)
    db.from('upload_batches')
      .update({ status: 'failed', error_message: `Edge function trigger failed: ${err.message}` })
      .eq('upload_batch_id', batchId)
      .then(null, () => {})
  })

  const totalRows = (batch.total_rows ?? batch.row_count ?? 0) as number
  return res.status(200).json({
    batch_id: batchId,
    status: 'processing',
    estimated_seconds: Math.max(10, Math.ceil(totalRows / 30)),
  })
}
