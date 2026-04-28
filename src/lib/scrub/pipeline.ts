import type { SupabaseClient } from '@supabase/supabase-js'
import { scrubAddress, type FieldMapping } from './scrubAddress'
import { smartyVerifyUs, smartyVerifyInternational } from './smarty'

export interface StagedRow {
  staged_id?: string
  upload_batch_id: string
  row_index: number
  original_row: Record<string, unknown>
  scrub_status: string
  scrub_corrections: unknown
  scrub_confidence: number
  scrub_issues: string[]
  dedupe_hash: string | null
  canonical_staged_id?: string | null
  existing_property_id?: string | null
  usps_verified?: boolean | null
  usps_response?: unknown
  validated_address: unknown
}

export interface PipelineSummary {
  total: number
  clean: number
  auto_corrected: number
  needs_review: number
  duplicate: number
  existing_property: number
}

export async function runScrubPipeline(
  batchId: string,
  rows: Record<string, unknown>[],
  mapping: FieldMapping,
  db: SupabaseClient,
  opts: {
    smartyAuthId?: string
    smartyAuthToken?: string
  } = {},
): Promise<PipelineSummary> {
  // Stage 0 — local scrub
  const staged: StagedRow[] = rows.map((row, i) => {
    const result = scrubAddress(row, mapping)
    return {
      upload_batch_id: batchId,
      row_index: i,
      original_row: row,
      scrub_status: result.status,
      scrub_corrections: result.corrections,
      scrub_confidence: result.confidence,
      scrub_issues: result.issues,
      dedupe_hash: result.dedupe_hash,
      validated_address: result.validated_address,
    }
  })

  // Stage 0b — dedupe within batch
  const hashToFirst = new Map<string, number>()
  for (let i = 0; i < staged.length; i++) {
    const h = staged[i].dedupe_hash
    if (!h) continue
    if (hashToFirst.has(h)) {
      staged[i].scrub_status = 'duplicate'
      // canonical_staged_id will be set after DB insert; store index temporarily
      staged[i].canonical_staged_id = String(hashToFirst.get(h))
    } else {
      hashToFirst.set(h, i)
    }
  }

  // Stage 0b — dedupe against existing properties
  const uniqueHashes = [...hashToFirst.keys()]
  if (uniqueHashes.length > 0) {
    const { data: existingProps } = await db
      .from('properties')
      .select('property_id, address_hash')
      .in('address_hash', uniqueHashes.map((h) => h.slice(0, 16))) // existing hash is 16-char prefix

    if (existingProps?.length) {
      const existingByShortHash = new Map(existingProps.map((p) => [p.address_hash, p.property_id]))
      for (const row of staged) {
        if (!row.dedupe_hash) continue
        const shortHash = row.dedupe_hash.slice(0, 16)
        const propId = existingByShortHash.get(shortHash)
        if (propId && row.scrub_status !== 'duplicate') {
          row.scrub_status = 'existing_property'
          row.existing_property_id = propId
        }
      }
    }
  }

  // Insert all staged rows
  const { data: insertedRows, error: insertErr } = await db
    .from('staged_addresses')
    .insert(staged.map((r) => ({
      upload_batch_id: r.upload_batch_id,
      row_index: r.row_index,
      original_row: r.original_row,
      scrub_status: r.scrub_status,
      scrub_corrections: r.scrub_corrections,
      scrub_confidence: r.scrub_confidence,
      scrub_issues: r.scrub_issues,
      dedupe_hash: r.dedupe_hash,
      existing_property_id: r.existing_property_id ?? null,
      validated_address: r.validated_address,
    })))
    .select('staged_id, row_index')

  if (insertErr) throw new Error(`Failed to insert staged rows: ${insertErr.message}`)

  // Resolve canonical_staged_id for duplicates now that we have real IDs
  const idByRowIndex = new Map((insertedRows ?? []).map((r) => [r.row_index, r.staged_id]))
  const dupeUpdates: Array<{ staged_id: string; canonical_staged_id: string }> = []
  for (let i = 0; i < staged.length; i++) {
    if (staged[i].scrub_status === 'duplicate' && staged[i].canonical_staged_id != null) {
      const canonicalIdx = parseInt(staged[i].canonical_staged_id as string, 10)
      const canonicalId = idByRowIndex.get(canonicalIdx)
      const thisId = idByRowIndex.get(i)
      if (canonicalId && thisId) {
        dupeUpdates.push({ staged_id: thisId, canonical_staged_id: canonicalId })
      }
    }
  }

  for (const u of dupeUpdates) {
    await db
      .from('staged_addresses')
      .update({ canonical_staged_id: u.canonical_staged_id })
      .eq('staged_id', u.staged_id)
  }

  // Stage 0c — Smarty validation (optional)
  if (opts.smartyAuthId && opts.smartyAuthToken) {
    await runSmartyValidation(batchId, db, opts.smartyAuthId, opts.smartyAuthToken)
  }

  const summary: PipelineSummary = {
    total: staged.length,
    clean: staged.filter((r) => r.scrub_status === 'clean').length,
    auto_corrected: staged.filter((r) => r.scrub_status === 'auto_corrected').length,
    needs_review: staged.filter((r) => r.scrub_status === 'needs_review').length,
    duplicate: staged.filter((r) => r.scrub_status === 'duplicate').length,
    existing_property: staged.filter((r) => r.scrub_status === 'existing_property').length,
  }

  return summary
}

async function runSmartyValidation(
  batchId: string,
  db: SupabaseClient,
  authId: string,
  authToken: string,
): Promise<void> {
  const { data: rows } = await db
    .from('staged_addresses')
    .select('staged_id, dedupe_hash, validated_address, scrub_status')
    .eq('upload_batch_id', batchId)
    .in('scrub_status', ['clean', 'auto_corrected'])

  if (!rows?.length) return

  // Dedupe by hash so we don't call Smarty twice for the same address
  const hashToRow = new Map<string, typeof rows[0]>()
  for (const row of rows) {
    if (row.dedupe_hash && !hashToRow.has(row.dedupe_hash)) {
      hashToRow.set(row.dedupe_hash, row)
    }
  }

  // Check cache: existing usps_response entries (same hash already validated)
  const hashes = [...hashToRow.keys()]
  const { data: cached } = await db
    .from('staged_addresses')
    .select('dedupe_hash, usps_verified, usps_response, validated_address')
    .in('dedupe_hash', hashes)
    .not('usps_response', 'is', null)

  const cacheMap = new Map((cached ?? []).map((r) => [r.dedupe_hash, r]))

  const updates: Array<{
    staged_id: string
    usps_verified: boolean
    usps_response: unknown
    validated_address: unknown
    scrub_status: string
  }> = []

  for (const [hash, row] of hashToRow) {
    const addr = row.validated_address as Record<string, string> | null
    if (!addr) continue

    const country = addr.country ?? 'US'
    if (country === 'MX') continue // skip MX

    let smartyResult: Awaited<ReturnType<typeof smartyVerifyUs>>

    if (cacheMap.has(hash)) {
      const c = cacheMap.get(hash)!
      // Apply cached result to all rows with this hash (handled in bulk below)
      for (const r of rows) {
        if (r.dedupe_hash === hash) {
          updates.push({
            staged_id: r.staged_id,
            usps_verified: c.usps_verified ?? false,
            usps_response: c.usps_response,
            validated_address: c.validated_address,
            scrub_status: r.scrub_status,
          })
        }
      }
      continue
    }

    try {
      if (country === 'US') {
        smartyResult = await smartyVerifyUs(addr as any, authId, authToken)
      } else {
        smartyResult = await smartyVerifyInternational(addr as any, authId, authToken)
      }
    } catch {
      continue
    }

    for (const r of rows) {
      if (r.dedupe_hash !== hash) continue
      const newStatus = !smartyResult.verified && r.scrub_status === 'clean'
        ? 'needs_review'
        : r.scrub_status
      updates.push({
        staged_id: r.staged_id,
        usps_verified: smartyResult.verified,
        usps_response: smartyResult.raw,
        validated_address: smartyResult.standardized ?? r.validated_address,
        scrub_status: newStatus,
      })
    }
  }

  for (const u of updates) {
    await db
      .from('staged_addresses')
      .update({
        usps_verified: u.usps_verified,
        usps_response: u.usps_response,
        validated_address: u.validated_address,
        scrub_status: u.scrub_status,
      })
      .eq('staged_id', u.staged_id)
  }
}
