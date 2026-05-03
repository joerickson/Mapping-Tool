// POST /api/v1/schedule-assessments/[id]/upload
//
// Body: { filename, cycle_label?, csv } where csv is the raw CSV
// content as a string. Parses it, persists a file row + N parsed
// rows in 'pending' state, then runs fuzzy matching against the
// client's service_locations and updates each row's match status.
//
// Returns the file id, parse errors, and a summary of match
// outcomes.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import { parseScheduleCsv } from '../../../_lib/schedule-assessment/parse-csv.js'
import { matchAddresses } from '../../../_lib/schedule-assessment/match-addresses.js'
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
  const insertedRows: Array<{ id: string; raw_address: string }> = []
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK).map((r) => ({
      assessment_id: assessmentId,
      file_id: fileId,
      raw_address: r.raw_address,
      raw_scheduled_date: r.raw_scheduled_date,
      raw_crew_name: r.raw_crew_name,
    }))
    const { data: inserted, error: insErr } = await db
      .from('schedule_assessment_rows')
      .insert(chunk)
      .select('id, raw_address')
    if (insErr) {
      return res.status(500).json({ error: `rows insert: ${insErr.message}` })
    }
    if (inserted) insertedRows.push(...(inserted as any[]))
  }

  // Resolve client_ids (combined → members) and run fuzzy matching.
  const memberIds = await resolveClientIds(db, clientId)
  const matches = await matchAddresses(
    db,
    memberIds,
    insertedRows.map((r) => ({ row_id: r.id, raw_address: r.raw_address }))
  )

  // Persist match results. Group updates by status to minimize round-trips.
  const updates: Array<{ id: string; matched_service_location_id: string | null; match_confidence: number | null; match_status: string }> = []
  for (const m of matches) {
    updates.push({
      id: m.row_id,
      matched_service_location_id: m.matched_sl_id,
      match_confidence: m.confidence,
      match_status: m.match_status === 'auto' ? 'auto' : (m.match_status === 'unmatched' ? 'unmatched' : 'pending'),
    })
  }
  // Batch the row-by-row updates. Supabase doesn't support a single
  // bulk UPDATE without a CTE; use upsert-by-id which is fine here.
  for (let i = 0; i < updates.length; i += INSERT_CHUNK) {
    const chunk = updates.slice(i, i + INSERT_CHUNK)
    const { error: upErr } = await db
      .from('schedule_assessment_rows')
      .upsert(chunk, { onConflict: 'id' })
    if (upErr) {
      // Non-fatal — surface but don't fail the whole upload.
      // eslint-disable-next-line no-console
      console.warn(`match update batch failed: ${upErr.message}`)
    }
  }

  // Bump assessment status to 'matched' if anything matched; otherwise leave 'draft'.
  if (matches.some((m) => m.match_status === 'auto')) {
    await db
      .from('schedule_assessments')
      .update({ status: 'matched', updated_at: new Date().toISOString() })
      .eq('id', assessmentId)
  }

  const summary = {
    rows_parsed: rows.length,
    auto_matched: matches.filter((m) => m.match_status === 'auto').length,
    review_needed: matches.filter((m) => m.match_status === 'pending').length,
    unmatched: matches.filter((m) => m.match_status === 'unmatched').length,
    parse_errors: errors,
  }
  return res.status(201).json({ file_id: fileId, summary })
}
