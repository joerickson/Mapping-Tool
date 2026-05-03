// POST /api/v1/schedule-assessments/[id]/upload
//
// Parses + persists raw CSV rows. Resolves obvious matches via
// location_code exact lookup (free, no API calls) but defers the
// real address resolution to /geocode-match — that step geocodes
// each unique address via Google and matches to nearby SLs by
// lat/lng, which is dramatically more reliable than string fuzzy.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import { parseScheduleCsv } from '../../../_lib/schedule-assessment/parse-csv.js'
import { resolveClientIds } from '../../../_lib/clients/resolve-client-ids.js'

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
  maxDuration: 120,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try { await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }
  const assessmentId = req.query.id as string
  const body = (req.body ?? {}) as {
    filename?: string
    cycle_label?: string
    csv?: string
    column_mapping?: {
      address?: string
      date_columns?: string[]
      crew?: string | null
      location_code?: string | null
      city?: string | null
      state?: string | null
      postal_code?: string | null
    }
  }
  if (!body.csv) return res.status(400).json({ error: 'csv required' })
  const filename = (body.filename ?? 'upload.csv').trim() || 'upload.csv'
  const cycleLabel = body.cycle_label ?? null
  const db = createAdminClient()

  const { data: assessment } = await db
    .from('schedule_assessments')
    .select('id, client_id')
    .eq('id', assessmentId)
    .maybeSingle()
  if (!assessment) return res.status(404).json({ error: 'Assessment not found' })
  const clientId = (assessment as any).client_id as string

  // Parse CSV. Operator may pass an explicit column_mapping to
  // bypass the heuristic header classifier — the wizard uses this
  // after the user confirms columns in the preview step.
  const { rows, errors } = parseScheduleCsv(body.csv, body.column_mapping)
  if (rows.length === 0) {
    // Surface the FULL parse-error detail in the response so the UI
    // can show the operator exactly which column was misclassified.
    // Roll the diagnostic into the top-level error so a basic toast
    // shows the headers we saw rather than just "no valid rows."
    const detail = errors.length > 0 ? `: ${errors[0].reason}` : ''
    return res.status(400).json({
      error: `No valid rows parsed${detail}`,
      parse_errors: errors,
    })
  }

  // Insert file.
  const { data: file, error: fileErr } = await db
    .from('schedule_assessment_files')
    .insert({
      assessment_id: assessmentId,
      filename,
      cycle_label: cycleLabel,
      row_count: rows.length,
    })
    .select('id')
    .single()
  if (fileErr || !file) {
    return res.status(500).json({ error: `file insert: ${fileErr?.message ?? 'unknown'}` })
  }
  const fileId = (file as any).id

  // Bulk-insert parsed rows. Chunk to keep payload sizes sane.
  const INSERT_CHUNK = 500
  const insertedRows: Array<{
    id: string
    raw_address: string
    raw_location_code: string | null
  }> = []
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK).map((r) => ({
      assessment_id: assessmentId,
      file_id: fileId,
      raw_address: r.raw_address,
      raw_scheduled_date: r.raw_scheduled_date,
      raw_crew_name: r.raw_crew_name,
      raw_location_code: r.raw_location_code,
      raw_city: r.raw_city,
      raw_state: r.raw_state,
      raw_postal_code: r.raw_postal_code,
    }))
    const { data: inserted, error: insErr } = await db
      .from('schedule_assessment_rows')
      .insert(chunk)
      .select('id, raw_address, raw_location_code')
    if (insErr) {
      return res.status(500).json({ error: `rows insert: ${insErr.message}` })
    }
    if (inserted) insertedRows.push(...(inserted as any[]))
  }

  // Resolve client_ids (combined → members) for SL lookups.
  const memberIds = await resolveClientIds(db, clientId)

  // Step A — exact location_code matches (free, no API calls). Build a
  // code-keyed lookup of this client's SLs.
  const codeMap = new Map<string, string>()
  if (insertedRows.some((r) => r.raw_location_code)) {
    const PAGE = 1000
    for (let p = 0; p < 50; p++) {
      const { data } = await db
        .from('service_locations')
        .select('id, location_code')
        .in('client_id', memberIds)
        .not('location_code', 'is', null)
        .range(p * PAGE, p * PAGE + PAGE - 1)
      const arr = data ?? []
      for (const r of arr as any[]) {
        if (r.location_code) codeMap.set(String(r.location_code).trim().toLowerCase(), r.id)
      }
      if (arr.length < PAGE) break
    }
  }
  const updates: Array<{
    id: string
    matched_service_location_id: string | null
    match_confidence: number | null
    match_status: string
  }> = []
  let codeMatchedCount = 0
  for (const r of insertedRows) {
    if (r.raw_location_code) {
      const slId = codeMap.get(r.raw_location_code.trim().toLowerCase())
      if (slId) {
        updates.push({
          id: r.id,
          matched_service_location_id: slId,
          match_confidence: 1.0,
          match_status: 'auto',
        })
        codeMatchedCount++
        continue
      }
    }
    // Defer everything else to the geocode-match step. Mark as
    // 'pending' so the operator sees it needs the geocode pass.
    updates.push({
      id: r.id,
      matched_service_location_id: null,
      match_confidence: null,
      match_status: 'pending',
    })
  }
  for (let i = 0; i < updates.length; i += INSERT_CHUNK) {
    const chunk = updates.slice(i, i + INSERT_CHUNK)
    const { error: upErr } = await db
      .from('schedule_assessment_rows')
      .upsert(chunk, { onConflict: 'id' })
    if (upErr) {
      // eslint-disable-next-line no-console
      console.warn(`match update batch failed: ${upErr.message}`)
    }
  }

  if (codeMatchedCount > 0) {
    await db
      .from('schedule_assessments')
      .update({ status: 'matched', updated_at: new Date().toISOString() })
      .eq('id', assessmentId)
  }

  const summary = {
    rows_parsed: rows.length,
    code_matched: codeMatchedCount,
    needs_geocode: insertedRows.length - codeMatchedCount,
    parse_errors: errors,
    note:
      insertedRows.length - codeMatchedCount > 0
        ? `Click "Geocode & match" next to resolve the remaining ${insertedRows.length - codeMatchedCount} rows by address → lat/lng → nearest SL.`
        : 'All rows matched via location_code.',
  }
  return res.status(201).json({ file_id: fileId, summary })
}
