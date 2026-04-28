/**
 * POST /api/v1/admin/parcels/import
 *
 * Accepts a multipart form upload (Shapefile .zip, .csv, or .geojson) plus
 * metadata fields, creates a parcel_county_imports record, then kicks off
 * async stream-processing.
 *
 * Note: For Shapefiles >4 MB deploy on Vercel Pro (maxDuration 300 s) or
 * migrate the processing step to a Supabase Edge Function.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import Busboy from 'busboy'
import { createAdminClient } from '../../../../_lib/supabase.js'
import { authenticateRequest } from '../../../../_lib/auth.js'
import { processImportJob } from './_processor.js'

export const config = {
  api: { bodyParser: false },
  maxDuration: 300,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let ctx
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  if (ctx.mode !== 'user') return res.status(403).json({ error: 'Forbidden' })

  const db = createAdminClient()

  // Parse multipart form
  const fields: Record<string, string> = {}
  let fileBuffer: Buffer | null = null
  let filename = ''
  let mimetype = ''

  await new Promise<void>((resolve, reject) => {
    const bb = Busboy({ headers: req.headers as Record<string, string> })

    bb.on('field', (name, value) => {
      fields[name] = value
    })

    bb.on('file', (_fieldname, stream, info) => {
      filename = info.filename
      mimetype = info.mimeType
      const chunks: Buffer[] = []
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('end', () => {
        fileBuffer = Buffer.concat(chunks)
      })
    })

    bb.on('finish', resolve)
    bb.on('error', reject)
    req.pipe(bb)
  })

  if (!fileBuffer) return res.status(400).json({ error: 'No file uploaded' })

  const { county_fips, county_name, state, source_refresh_date } = fields

  if (!county_fips?.match(/^\d{5}$/)) {
    return res.status(400).json({ error: 'county_fips must be a 5-digit FIPS code' })
  }
  if (!county_name || !state?.match(/^[A-Z]{2}$/i)) {
    return res.status(400).json({ error: 'county_name and state (2-letter) are required' })
  }

  // Detect format from filename / mimetype
  const fname = filename.toLowerCase()
  let source_format: string
  if (fname.endsWith('.zip')) source_format = 'shapefile'
  else if (fname.endsWith('.csv') || mimetype.includes('csv')) source_format = 'csv'
  else if (fname.endsWith('.geojson') || fname.endsWith('.json')) source_format = 'geojson'
  else return res.status(400).json({ error: 'Unsupported file type; expected .zip, .csv, or .geojson' })

  const { data: importJob, error: insertErr } = await db
    .from('parcel_county_imports')
    .insert({
      county_fips,
      county_name,
      state: state.toUpperCase(),
      source_format,
      source_filename: filename,
      source_refresh_date: source_refresh_date || null,
      status: 'pending',
      imported_by: ctx.userId ?? null,
    })
    .select('id')
    .single()

  if (insertErr || !importJob) {
    return res.status(500).json({ error: insertErr?.message ?? 'Failed to create import record' })
  }

  // Fire-and-forget processing
  const importId = importJob.id
  ;(async () => {
    try {
      await db
        .from('parcel_county_imports')
        .update({ status: 'importing', started_at: new Date().toISOString() })
        .eq('id', importId)

      await processImportJob({
        importId,
        fileBuffer,
        source_format,
        county_fips,
        county_name,
        state: state.toUpperCase(),
        source_refresh_date: source_refresh_date || null,
        db,
      })

      await db
        .from('parcel_county_imports')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', importId)
    } catch (err) {
      console.error('[import] Job failed:', err)
      await db
        .from('parcel_county_imports')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_log: [{ message: String(err) }],
        })
        .eq('id', importId)
    }
  })()

  return res.status(202).json({ import_id: importId, status: 'pending' })
}
