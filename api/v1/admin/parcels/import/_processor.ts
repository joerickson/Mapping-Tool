/**
 * Stream-processes Shapefile, CSV, or GeoJSON uploads into the parcels table.
 * All formats are processed in 500-row batches to stay within Supabase limits.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { mapRegridFields } from '../../../../../src/lib/parcel/fieldMapper'

const BATCH_SIZE = 500

export interface ProcessImportOptions {
  importId: string
  fileBuffer: Buffer
  source_format: string
  county_fips: string
  county_name: string
  state: string
  source_refresh_date: string | null
  db: SupabaseClient
}

export async function processImportJob(opts: ProcessImportOptions): Promise<void> {
  const { source_format } = opts

  if (source_format === 'shapefile') {
    await processShapefile(opts)
  } else if (source_format === 'csv') {
    await processCsv(opts)
  } else if (source_format === 'geojson') {
    await processGeoJson(opts)
  }
}

// ─── Shapefile (.zip) ────────────────────────────────────────────────────────

async function processShapefile(opts: ProcessImportOptions) {
  const { fileBuffer, db, importId } = opts
  // Dynamic imports kept here so the frontend bundle never pulls in these packages
  const JSZip = (await import('jszip')).default
  const shapefile = await import('shapefile')
  const proj4 = (await import('proj4')).default

  const zip = new JSZip()
  await zip.loadAsync(fileBuffer)

  // Find .shp, .dbf, .prj (case-insensitive)
  const files = Object.keys(zip.files)
  const shpName = files.find((f) => f.toLowerCase().endsWith('.shp'))
  const dbfName = files.find((f) => f.toLowerCase().endsWith('.dbf'))
  const prjName = files.find((f) => f.toLowerCase().endsWith('.prj'))

  if (!shpName || !dbfName) throw new Error('ZIP does not contain .shp and .dbf files')

  const shpBuf = Buffer.from(await zip.files[shpName].async('arraybuffer'))
  const dbfBuf = Buffer.from(await zip.files[dbfName].async('arraybuffer'))

  // Detect projection from .prj
  let toWgs84: ((coord: number[]) => number[]) | null = null
  if (prjName) {
    try {
      const prjText = await zip.files[prjName].async('text')
      if (!prjText.includes('GCS_WGS_1984') && !prjText.includes('WGS84')) {
        proj4.defs('SOURCECRS', prjText)
        toWgs84 = (coord: number[]) => proj4('SOURCECRS', 'WGS84', coord)
      }
    } catch {
      // Non-fatal: assume WGS84
    }
  }

  const source = await shapefile.open(shpBuf, dbfBuf, { encoding: 'UTF-8' })

  const batch: Record<string, unknown>[] = []
  const errors: Record<string, unknown>[] = []
  let count = 0

  while (true) {
    const result = await source.read()
    if (result.done) break

    try {
      const feature = result.value
      let geom = feature.geometry

      // Reproject if needed
      if (toWgs84 && geom?.type === 'Polygon') {
        geom = {
          ...geom,
          coordinates: geom.coordinates.map((ring: number[][]) =>
            ring.map((coord) => toWgs84!(coord))
          ),
        }
      }

      const props = (feature.properties ?? {}) as Record<string, unknown>
      const mapped = mapRegridFields(props as any)

      batch.push(buildParcelRow(geom, mapped, opts))

      if (batch.length >= BATCH_SIZE) {
        const { error } = await db.from('parcels').upsert(batch, { onConflict: 'regrid_ll_uuid' })
        if (error) errors.push({ batch_start: count, message: error.message })
        count += batch.length
        batch.length = 0
        await db
          .from('parcel_county_imports')
          .update({ parcel_count: count })
          .eq('id', importId)
      }
    } catch (err) {
      errors.push({ index: count, message: String(err) })
    }
  }

  if (batch.length) {
    const { error } = await db.from('parcels').upsert(batch, { onConflict: 'regrid_ll_uuid' })
    if (error) errors.push({ batch_start: count, message: error.message })
    count += batch.length
  }

  await db
    .from('parcel_county_imports')
    .update({
      parcel_count: count,
      error_log: errors.length ? errors : null,
    })
    .eq('id', importId)
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

async function processCsv(opts: ProcessImportOptions) {
  const { fileBuffer, db, importId } = opts
  const Papa = (await import('papaparse')).default

  // Collect all rows synchronously (papaparse step is sync-only)
  const rows: Record<string, unknown>[] = []
  const parseErrors: Record<string, unknown>[] = []

  await new Promise<void>((resolve, reject) => {
    Papa.parse(fileBuffer.toString('utf8'), {
      header: true,
      skipEmptyLines: true,
      step: (result: { data: Record<string, unknown>; errors: unknown[] }) => {
        if (result.errors?.length) {
          parseErrors.push({ row: rows.length, errors: result.errors })
          return
        }
        rows.push(result.data)
      },
      complete: () => resolve(),
      error: reject,
    })
  })

  const errors: Record<string, unknown>[] = [...parseErrors]
  let count = 0
  const batch: Record<string, unknown>[] = []

  for (const row of rows) {
    try {
      const mapped = mapRegridFields(row as any)
      batch.push(buildParcelRow(null, mapped, opts))
    } catch (err) {
      errors.push({ index: count, message: String(err) })
    }

    if (batch.length >= BATCH_SIZE) {
      const { error } = await db.from('parcels').upsert([...batch], { onConflict: 'regrid_ll_uuid' })
      if (error) errors.push({ batch_start: count, message: error.message })
      count += batch.length
      batch.length = 0
      await db.from('parcel_county_imports').update({ parcel_count: count }).eq('id', importId)
    }
  }

  if (batch.length) {
    const { error } = await db.from('parcels').upsert([...batch], { onConflict: 'regrid_ll_uuid' })
    if (error) errors.push({ batch_end: true, message: error.message })
    count += batch.length
  }

  await db
    .from('parcel_county_imports')
    .update({ parcel_count: count, error_log: errors.length ? errors : null })
    .eq('id', importId)
}

// ─── GeoJSON ─────────────────────────────────────────────────────────────────

async function processGeoJson(opts: ProcessImportOptions) {
  const { fileBuffer, db, importId } = opts

  const geojson = JSON.parse(fileBuffer.toString('utf8'))
  const features = geojson.type === 'FeatureCollection' ? geojson.features : [geojson]

  const batch: Record<string, unknown>[] = []
  const errors: Record<string, unknown>[] = []
  let count = 0

  for (const feature of features) {
    try {
      const props = (feature.properties ?? {}) as Record<string, unknown>
      const mapped = mapRegridFields(props as any)
      batch.push(buildParcelRow(feature.geometry, mapped, opts))

      if (batch.length >= BATCH_SIZE) {
        const { error } = await db.from('parcels').upsert(batch, { onConflict: 'regrid_ll_uuid' })
        if (error) errors.push({ batch_start: count, message: error.message })
        count += batch.length
        batch.length = 0
        await db
          .from('parcel_county_imports')
          .update({ parcel_count: count })
          .eq('id', importId)
      }
    } catch (err) {
      errors.push({ index: count, message: String(err) })
    }
  }

  if (batch.length) {
    const { error } = await db.from('parcels').upsert(batch, { onConflict: 'regrid_ll_uuid' })
    if (error) errors.push({ batch_end: true, message: error.message })
    count += batch.length
  }

  await db
    .from('parcel_county_imports')
    .update({
      parcel_count: count,
      error_log: errors.length ? errors : null,
    })
    .eq('id', importId)
}

// ─── shared ──────────────────────────────────────────────────────────────────

function computeCentroid(
  geom: { type: string; coordinates: number[][][] } | null,
  axis: 'lat' | 'lng'
): number | null {
  if (!geom || geom.type !== 'Polygon' || !geom.coordinates?.[0]?.length) return null
  const coords = geom.coordinates[0]
  const idx = axis === 'lat' ? 1 : 0
  return coords.reduce((s, c) => s + c[idx], 0) / coords.length
}

function buildParcelRow(
  geom: unknown,
  mapped: ReturnType<typeof mapRegridFields>,
  opts: ProcessImportOptions
): Record<string, unknown> {
  const g = geom as { type: string; coordinates: number[][][] } | null
  return {
    regrid_ll_uuid: mapped.regrid_ll_uuid ?? null,
    parcel_number: mapped.parcel_number ?? null,
    county_fips: opts.county_fips,
    state: opts.state,
    county_name: opts.county_name,
    geometry: geom ?? null,
    centroid_lat: computeCentroid(g, 'lat'),
    centroid_lng: computeCentroid(g, 'lng'),
    building_sqft: mapped.building_sqft ?? null,
    lot_sqft: mapped.lot_sqft ?? null,
    year_built: mapped.year_built ?? null,
    zoning_code: mapped.zoning_code ?? null,
    land_use_code: mapped.land_use_code ?? null,
    land_use_standardized: mapped.land_use_standardized ?? null,
    owner_name: mapped.owner_name ?? null,
    owner_mailing_address: mapped.owner_mailing_address ?? null,
    source_refresh_date: opts.source_refresh_date,
  }
}
