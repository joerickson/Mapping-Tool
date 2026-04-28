import type { SupabaseClient } from '@supabase/supabase-js'
import { scrubAddress, type FieldMapping } from './scrubAddress'
import {
  googleValidateAddress,
  granularityConfidence,
  type ValidationGranularity,
} from './googleAddressValidation'

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
  validation_granularity?: string | null
  latitude?: number | null
  longitude?: number | null
  geocoded_at?: string | null
  geocode_source?: string | null
}

export interface PipelineSummary {
  total: number
  clean: number
  auto_corrected: number
  needs_review: number
  duplicate: number
  existing_property: number
  address_validation_calls: number
}

export async function runScrubPipeline(
  batchId: string,
  rows: Record<string, unknown>[],
  mapping: FieldMapping,
  db: SupabaseClient,
  opts: {
    googleAddressValidationKey?: string
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

  // Stage 0c — Google Address Validation (optional)
  let addressValidationCalls = 0
  if (opts.googleAddressValidationKey) {
    addressValidationCalls = await runGoogleAddressValidation(
      batchId,
      db,
      opts.googleAddressValidationKey,
    )
  }

  // Re-read final statuses from in-memory staged array for summary
  // (statuses may have changed during dedup — Google validation updates come from DB)
  const { data: finalRows } = await db
    .from('staged_addresses')
    .select('scrub_status')
    .eq('upload_batch_id', batchId)

  const finalStatuses = finalRows?.map((r) => r.scrub_status) ?? staged.map((r) => r.scrub_status)

  const summary: PipelineSummary = {
    total: staged.length,
    clean: finalStatuses.filter((s) => s === 'clean').length,
    auto_corrected: finalStatuses.filter((s) => s === 'auto_corrected').length,
    needs_review: finalStatuses.filter((s) => s === 'needs_review').length,
    duplicate: finalStatuses.filter((s) => s === 'duplicate').length,
    existing_property: finalStatuses.filter((s) => s === 'existing_property').length,
    address_validation_calls: addressValidationCalls,
  }

  return summary
}

function resolveNewStatus(
  currentStatus: string,
  granularity: ValidationGranularity | string,
  hasUnconfirmedComponents: boolean,
): string {
  if (granularity === 'OTHER' || hasUnconfirmedComponents) return 'needs_review'
  return currentStatus
}

function resolveNewConfidence(
  granularity: ValidationGranularity | string,
  addressComplete: boolean,
  uspsVerified: boolean,
): number {
  if (granularity === 'PREMISE' && addressComplete && uspsVerified) return 1.0
  return granularityConfidence(granularity)
}

async function runGoogleAddressValidation(
  batchId: string,
  db: SupabaseClient,
  apiKey: string,
): Promise<number> {
  const { data: rows } = await db
    .from('staged_addresses')
    .select('staged_id, dedupe_hash, validated_address, scrub_status')
    .eq('upload_batch_id', batchId)
    .in('scrub_status', ['clean', 'auto_corrected'])

  if (!rows?.length) return 0

  // Dedupe by hash — one API call per unique address
  const hashToRow = new Map<string, typeof rows[0]>()
  for (const row of rows) {
    if (row.dedupe_hash && !hashToRow.has(row.dedupe_hash)) {
      hashToRow.set(row.dedupe_hash, row)
    }
  }

  // Cache: reuse results for hashes validated in previous batches
  const hashes = [...hashToRow.keys()]
  const { data: cached } = await db
    .from('staged_addresses')
    .select('dedupe_hash, usps_verified, usps_response, validated_address, validation_granularity, latitude, longitude, geocoded_at, geocode_source, scrub_confidence')
    .in('dedupe_hash', hashes)
    .not('validation_granularity', 'is', null)

  const cacheMap = new Map((cached ?? []).map((r) => [r.dedupe_hash, r]))

  const updates: Array<{
    staged_id: string
    usps_verified: boolean
    usps_response: unknown
    validated_address: unknown
    validation_granularity: string
    scrub_status: string
    scrub_confidence: number
    latitude: number | null
    longitude: number | null
    geocoded_at: string | null
    geocode_source: string | null
  }> = []

  let apiCallCount = 0

  for (const [hash, row] of hashToRow) {
    const addr = row.validated_address as Record<string, string> | null
    if (!addr) continue

    if (cacheMap.has(hash)) {
      const c = cacheMap.get(hash)!
      for (const r of rows) {
        if (r.dedupe_hash !== hash) continue
        updates.push({
          staged_id: r.staged_id,
          usps_verified: c.usps_verified ?? false,
          usps_response: c.usps_response,
          validated_address: c.validated_address,
          validation_granularity: c.validation_granularity,
          scrub_status: resolveNewStatus(r.scrub_status, c.validation_granularity, false),
          scrub_confidence: c.scrub_confidence ?? granularityConfidence(c.validation_granularity),
          latitude: c.latitude ?? null,
          longitude: c.longitude ?? null,
          geocoded_at: c.geocoded_at ?? null,
          geocode_source: c.geocode_source ?? null,
        })
      }
      continue
    }

    let gResult: Awaited<ReturnType<typeof googleValidateAddress>>
    try {
      gResult = await googleValidateAddress(addr as any, apiKey)
    } catch {
      continue
    }
    if (!gResult) continue
    apiCallCount++

    for (const r of rows) {
      if (r.dedupe_hash !== hash) continue
      updates.push({
        staged_id: r.staged_id,
        usps_verified: gResult.uspsVerified,
        usps_response: gResult.uspsResponse,
        validated_address: gResult.postalAddress ?? r.validated_address,
        validation_granularity: gResult.granularity,
        scrub_status: resolveNewStatus(r.scrub_status, gResult.granularity, gResult.hasUnconfirmedComponents),
        scrub_confidence: resolveNewConfidence(gResult.granularity, gResult.addressComplete, gResult.uspsVerified),
        latitude: gResult.latitude ?? null,
        longitude: gResult.longitude ?? null,
        geocoded_at: gResult.geocodedAt ?? null,
        geocode_source: gResult.latitude != null ? 'google_address_validation' : null,
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
        validation_granularity: u.validation_granularity,
        scrub_status: u.scrub_status,
        scrub_confidence: u.scrub_confidence,
        latitude: u.latitude,
        longitude: u.longitude,
        geocoded_at: u.geocoded_at,
        geocode_source: u.geocode_source,
      })
      .eq('staged_id', u.staged_id)
  }

  return apiCallCount
}
