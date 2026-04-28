// Supabase Edge Function — Deno runtime
// Processes an upload batch: reads file from Storage, validates rows,
// inserts upload_staged_rows, then marks batch as completed.

// @ts-ignore esm.sh CDN
import * as XLSX from 'https://esm.sh/xlsx@0.18.5'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CHUNK_SIZE = 100

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ─── Address normalization helpers ────────────────────────────────────────────

const COUNTRY_ALIASES: Record<string, string> = {
  us: 'US', usa: 'US', 'united states': 'US', 'united states of america': 'US', america: 'US',
  ca: 'CA', can: 'CA', canada: 'CA',
  mx: 'MX', mex: 'MX', mexico: 'MX',
}

function normalizeCountry(raw: string): string | null {
  return COUNTRY_ALIASES[raw.toLowerCase().trim()] ?? null
}

const US_STATE_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS',
  kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA',
  michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC',
}

const CA_PROVINCE_NAMES: Record<string, string> = {
  alberta: 'AB', 'british columbia': 'BC', manitoba: 'MB', 'new brunswick': 'NB',
  newfoundland: 'NL', 'nova scotia': 'NS', ontario: 'ON', 'prince edward island': 'PE',
  quebec: 'QC', 'québec': 'QC', saskatchewan: 'SK', yukon: 'YT',
}

function normalizeState(state: string, country: string): { value: string; corrected: boolean } {
  const up = state.toUpperCase().trim()
  const low = state.toLowerCase().trim()
  if (country === 'CA') {
    const fromName = CA_PROVINCE_NAMES[low]
    if (fromName) return { value: fromName, corrected: true }
    return { value: up, corrected: up !== state.trim() }
  }
  const fromName = US_STATE_NAMES[low]
  if (fromName) return { value: fromName, corrected: true }
  return { value: up, corrected: up !== state.trim() }
}

function normalizePostal(postal: string, country: string): { value: string; corrected: boolean } {
  if (country === 'US') {
    const pc = postal.replace(/\.0+$/, '')
    if (/^\d{9}$/.test(pc)) return { value: `${pc.slice(0, 5)}-${pc.slice(5)}`, corrected: true }
    if (/^\d{5}(-\d{4})?$/.test(pc)) return { value: pc, corrected: pc !== postal }
    return { value: postal, corrected: false }
  }
  if (country === 'CA') {
    let pc = postal.toUpperCase().replace(/\s/g, '')
    if (pc.length !== 6) return { value: postal, corrected: false }
    let oFixed = false
    for (const idx of [1, 3, 5]) {
      if (pc[idx] === 'O') { pc = pc.slice(0, idx) + '0' + pc.slice(idx + 1); oFixed = true }
    }
    const formatted = `${pc.slice(0, 3)} ${pc.slice(3)}`
    return { value: formatted, corrected: formatted !== postal || oFixed }
  }
  return { value: postal, corrected: false }
}

// ─── SHA-256 dedupe hash ───────────────────────────────────────────────────────

async function dedupeHash(addr1: string, city: string, state: string, postal: string): Promise<string> {
  const msg = [addr1, city, state, postal.slice(0, 5)].map((s) => s.toLowerCase().trim().replace(/\s+/g, ' ')).join('|')
  const data = new TextEncoder().encode(msg)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ─── Row processing ───────────────────────────────────────────────────────────

interface ProcessedRow {
  outcome: 'valid' | 'invalid' | 'corrected' | 'duplicate_within_batch' | 'duplicate_existing'
  property_data: Record<string, unknown>
  service_location_data: Record<string, unknown>
  dedupe_hash: string | null
  error_messages: string[]
  corrections: Array<{ field: string; from: string; to: string }>
  existing_property_id: string | null
}

async function processRow(
  rawRow: Record<string, unknown>,
  columnMapping: Record<string, string>,
  serviceOfferingId: string | null,
  clientId: string,
  batchDedupeSet: Map<string, string>, // hash → first row id
  db: ReturnType<typeof createClient>,
): Promise<ProcessedRow> {
  const errors: string[] = []
  const corrections: Array<{ field: string; from: string; to: string }> = []
  const mapped: Record<string, string> = {}

  // Apply column mapping
  for (const [sourceCol, targetField] of Object.entries(columnMapping)) {
    if (!targetField || targetField === 'skip') continue
    const val = String(rawRow[sourceCol] ?? '').trim()
    if (val) mapped[targetField] = val
  }

  // Validate required fields
  const addr1 = mapped['address_line1'] ?? ''
  const city = mapped['city'] ?? ''
  const state = mapped['state'] ?? ''
  const country = mapped['country'] ?? ''
  const postal = mapped['postal_code'] ?? ''

  if (!addr1) errors.push('address_line1 is required')
  if (!city) errors.push('city is required')
  if (!state && !country) errors.push('state or country is required')

  if (errors.length) {
    return {
      outcome: 'invalid',
      property_data: mapped,
      service_location_data: {},
      dedupe_hash: null,
      error_messages: errors,
      corrections: [],
      existing_property_id: null,
    }
  }

  // Normalize country
  let normalizedCountry = country
  if (country) {
    const nc = normalizeCountry(country)
    if (nc && nc !== country) {
      corrections.push({ field: 'country', from: country, to: nc })
      normalizedCountry = nc
    }
  } else {
    normalizedCountry = 'US' // default
  }

  // Normalize state
  let normalizedState = state
  if (state) {
    const ns = normalizeState(state, normalizedCountry)
    if (ns.corrected) {
      corrections.push({ field: 'state', from: state, to: ns.value })
    }
    normalizedState = ns.value
  }

  // Normalize postal
  let normalizedPostal = postal
  if (postal) {
    const np = normalizePostal(postal, normalizedCountry)
    if (np.corrected) {
      corrections.push({ field: 'postal_code', from: postal, to: np.value })
    }
    normalizedPostal = np.value
  }

  // Build property_data
  const propertyData: Record<string, unknown> = {
    address_line1: addr1,
    address_line2: mapped['address_line2'] ?? null,
    city,
    state: normalizedState,
    postal_code: normalizedPostal,
    country: normalizedCountry,
    client_id: clientId,
  }

  // Build service_location_data (custom fields prefixed with "custom:")
  const customFields: Record<string, unknown> = {}
  for (const [target, val] of Object.entries(mapped)) {
    if (target.startsWith('custom:')) {
      const key = target.slice(7)
      customFields[key] = val
    }
  }

  const serviceLocationData: Record<string, unknown> = {
    service_offering_id: serviceOfferingId,
    display_name: mapped['property_name'] ?? mapped['alternate_name'] ?? null,
    location_code: mapped['identifier'] ?? null,
    suite_or_floor: mapped['suite_or_floor'] ?? null,
    serviceable_sqft: mapped['serviceable_sqft'] ? Number(mapped['serviceable_sqft']) || null : null,
    frequency_notes: mapped['frequency_notes'] ?? null,
    custom_fields: customFields,
  }

  // Compute dedupe hash
  const hash = await dedupeHash(addr1, city, normalizedState, normalizedPostal)

  // Check for duplicate within batch
  if (batchDedupeSet.has(hash)) {
    return {
      outcome: 'duplicate_within_batch',
      property_data: propertyData,
      service_location_data: serviceLocationData,
      dedupe_hash: hash,
      error_messages: [],
      corrections,
      existing_property_id: null,
    }
  }
  batchDedupeSet.set(hash, hash)

  // Check for existing property in DB
  const { data: existingProp } = await db
    .from('properties')
    .select('property_id')
    .eq('address_hash', hash)
    .eq('client_id', clientId)
    .maybeSingle()

  const outcome = corrections.length > 0 ? 'corrected' : 'valid'

  return {
    outcome: existingProp ? 'duplicate_existing' : outcome,
    property_data: propertyData,
    service_location_data: serviceLocationData,
    dedupe_hash: hash,
    error_messages: [],
    corrections,
    existing_property_id: existingProp?.property_id ?? null,
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const db = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const body = await req.json()
    const batchId: string = body.batch_id
    if (!batchId) {
      return new Response(JSON.stringify({ error: 'batch_id required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // Load batch
    const { data: batch, error: batchErr } = await db
      .from('upload_batches')
      .select('*')
      .eq('upload_batch_id', batchId)
      .single()

    if (batchErr || !batch) {
      return new Response(JSON.stringify({ error: 'Batch not found' }), {
        status: 404, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const processingConfig = batch.processing_config as {
      sheet_mappings: Array<{ sheet_name: string; service_offering_id: string | null; skip: boolean }>
      column_mappings: Record<string, Record<string, string>>
    } | null

    if (!processingConfig) {
      await db.from('upload_batches').update({ status: 'failed', error_message: 'No processing config' }).eq('upload_batch_id', batchId)
      return new Response(JSON.stringify({ error: 'No processing config' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // Download file from Storage
    const filePath = batch.file_path as string | null
    if (!filePath) {
      await db.from('upload_batches').update({ status: 'failed', error_message: 'No file stored' }).eq('upload_batch_id', batchId)
      return new Response(JSON.stringify({ error: 'No file in storage' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const { data: fileData, error: dlErr } = await db.storage.from('upload-batches').download(filePath)
    if (dlErr || !fileData) {
      await db.from('upload_batches').update({ status: 'failed', error_message: `Storage download failed: ${dlErr?.message}` }).eq('upload_batch_id', batchId)
      return new Response(JSON.stringify({ error: 'Storage download failed' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const fileBuffer = await fileData.arrayBuffer()
    const ext = filePath.split('.').pop()?.toLowerCase() ?? 'xlsx'

    // Parse sheets
    const wb = XLSX.read(new Uint8Array(fileBuffer), { type: 'array' })

    const stats = {
      total: 0, valid: 0, corrected: 0, invalid: 0,
      duplicate_within_batch: 0, duplicate_existing: 0,
    }

    const clientId = batch.client_id as string

    for (const sheetMapping of processingConfig.sheet_mappings) {
      if (sheetMapping.skip) continue

      const sheetName = sheetMapping.sheet_name
      const sheet = wb.Sheets[sheetName] ?? (ext === 'csv' ? wb.Sheets[wb.SheetNames[0]] : null)
      if (!sheet) continue

      const columnMapping = processingConfig.column_mappings[sheetName] ?? {}
      const serviceOfferingId = sheetMapping.service_offering_id

      const sheets = (batch.sheets ?? []) as Array<{ name: string; header_row_index?: number }>
      const sheetMeta = sheets.find((s) => s.name === sheetName)
      const headerRowIndex = sheetMeta?.header_row_index ?? 0

      // Read all rows as position arrays so we can use trimmed header names for lookup
      const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: null,
        blankrows: false,
      })

      // Build column-index → target-field lookup; trim cell names to match stored column names
      const headerRow = (rawRows[headerRowIndex] ?? []) as unknown[]
      const indexToTarget: Record<number, string> = {}
      headerRow.forEach((colName, idx) => {
        if (colName === null || colName === undefined) return
        const trimmed = String(colName).trim()
        const target = columnMapping[trimmed]
        if (target && target !== '' && target !== 'skip') indexToTarget[idx] = target
      })

      // Identity mapping so processRow passes pre-mapped values through unchanged
      const identityMapping: Record<string, string> = {}
      for (const target of Object.values(indexToTarget)) identityMapping[target] = target

      // Data rows start immediately after the header row
      const dataRows = rawRows.slice(headerRowIndex + 1)
      const batchDedupeSet = new Map<string, string>()

      // Update current sheet
      await db.from('upload_batches').update({ current_sheet: sheetName }).eq('upload_batch_id', batchId)

      for (let i = 0; i < dataRows.length; i += CHUNK_SIZE) {
        const chunk = dataRows.slice(i, i + CHUNK_SIZE)
        const staged = []

        for (let j = 0; j < chunk.length; j++) {
          const rowArr = chunk[j] as unknown[]

          // Skip entirely empty rows
          if (!rowArr.some((cell) => cell !== null && cell !== undefined && cell !== '')) continue

          // Build pre-mapped row keyed by target field name using column-index lookup
          const preMapped: Record<string, unknown> = {}
          for (const [idxStr, target] of Object.entries(indexToTarget)) {
            const cell = rowArr[Number(idxStr)]
            if (cell !== null && cell !== undefined && cell !== '') preMapped[target] = cell
          }

          const rowIdx = i + j
          const result = await processRow(preMapped, identityMapping, serviceOfferingId, clientId, batchDedupeSet, db)

          stats.total++
          stats[result.outcome as keyof typeof stats] = (stats[result.outcome as keyof typeof stats] ?? 0) + 1

          staged.push({
            upload_batch_id: batchId,
            sheet_name: sheetName,
            row_index: rowIdx,
            service_offering_id: serviceOfferingId,
            outcome: result.outcome,
            dedupe_hash: result.dedupe_hash,
            property_data: result.property_data,
            service_location_data: result.service_location_data,
            error_messages: result.error_messages,
            corrections: result.corrections,
            existing_property_id: result.existing_property_id,
          })
        }

        // Upsert staged rows
        if (staged.length > 0) {
          await db.from('upload_staged_rows').upsert(staged, {
            onConflict: 'upload_batch_id,sheet_name,row_index',
            ignoreDuplicates: false,
          })
        }

        // Update progress
        await db
          .from('upload_batches')
          .update({
            rows_processed: i + chunk.length,
            errors_count: stats.invalid,
            validation_errors_count: stats.invalid,
          })
          .eq('upload_batch_id', batchId)
      }
    }

    // Mark complete
    await db
      .from('upload_batches')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        rows_processed: stats.total,
        errors_count: stats.invalid,
        validation_errors_count: stats.invalid,
        auto_corrections_count: stats.corrected,
        current_sheet: null,
        summary_stats: stats,
      })
      .eq('upload_batch_id', batchId)

    return new Response(JSON.stringify({ batch_id: batchId, status: 'completed', stats }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('process-upload-batch error:', msg)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
