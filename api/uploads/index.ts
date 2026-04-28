import type { VercelRequest, VercelResponse } from '@vercel/node'
import Busboy from 'busboy'
import * as XLSX from 'xlsx'
import Papa from 'papaparse'
import { createAdminClient } from '../_lib/supabase.js'
import { authenticateRequest } from '../_lib/auth.js'

export const config = { maxDuration: 60 }

const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25 MB
const ALLOWED_EXTS = new Set(['csv', 'xlsx', 'xls'])

interface SheetMeta {
  name: string
  row_count: number
  columns: string[]
  header_row_index: number
}

function detectHeaderRow(allRows: unknown[][]): number {
  for (let i = 0; i < Math.min(5, allRows.length); i++) {
    const row = allRows[i]
    const nonNull = row.filter((c) => c !== null && c !== undefined && c !== '')
    if (nonNull.length < 3) continue
    const stringLike = nonNull.filter(
      (c) => typeof c === 'string' && !/^\d+\.\d+$/.test(c),
    )
    if (stringLike.length >= nonNull.length * 0.7) return i
  }
  return 0
}

function parseSheetsFromBuffer(buf: Buffer, ext: string): SheetMeta[] {
  if (ext === 'csv') {
    const text = buf.toString('utf-8')
    const result = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true })
    const columns = (result.meta.fields ?? []).filter(Boolean)
    return [{ name: 'Sheet1', row_count: result.data.length, columns, header_row_index: 0 }]
  }

  const wb = XLSX.read(buf, { type: 'buffer' })
  return wb.SheetNames.map((name) => {
    const sheet = wb.Sheets[name]
    const allRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      blankrows: false,
    })

    if (allRows.length === 0) {
      return { name, columns: [], row_count: 0, header_row_index: -1 }
    }

    const headerIndex = detectHeaderRow(allRows)
    const columns = (allRows[headerIndex] ?? [])
      .map((h) => (h === null || h === undefined ? '' : String(h).trim()))
      .filter(Boolean)

    const dataRows = allRows
      .slice(headerIndex + 1)
      .filter((row) => row.some((cell) => cell !== null && cell !== undefined && cell !== ''))

    return { name, columns, row_count: dataRows.length, header_row_index: headerIndex }
  })
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

  return new Promise<void>((resolve) => {
    let bb: ReturnType<typeof Busboy>
    try {
      bb = Busboy({ headers: req.headers, limits: { fileSize: MAX_FILE_SIZE + 1 } })
    } catch {
      res.status(400).json({ error: 'Invalid multipart request' })
      return resolve()
    }

    let fileBuffer: Buffer | null = null
    let fileName = 'upload'
    let fileSizeExceeded = false
    const fields: Record<string, string> = {}

    bb.on('file', (_fieldname, file, info) => {
      fileName = info.filename ?? 'upload'
      const chunks: Buffer[] = []
      let size = 0

      file.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_FILE_SIZE) {
          fileSizeExceeded = true
          file.resume()
          return
        }
        chunks.push(chunk)
      })

      file.on('end', () => {
        if (!fileSizeExceeded) fileBuffer = Buffer.concat(chunks)
      })
    })

    bb.on('field', (name, value) => {
      fields[name] = value
    })

    bb.on('finish', async () => {
      if (fileSizeExceeded) {
        res.status(400).json({ error: 'File too large. Maximum size is 25 MB.' })
        return resolve()
      }

      if (!fileBuffer) {
        res.status(400).json({ error: 'No file provided' })
        return resolve()
      }

      const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
      if (!ALLOWED_EXTS.has(ext)) {
        res.status(400).json({ error: 'Unsupported file type. Use .csv, .xlsx, or .xls' })
        return resolve()
      }

      const accountId: string = fields.account_id ?? ''
      const clientId: string = fields.client_id ?? ''
      const batchTag: string | null = fields.batch_tag || null

      if (!accountId || !clientId) {
        res.status(400).json({ error: 'account_id and client_id are required' })
        return resolve()
      }

      let sheets: SheetMeta[]
      try {
        sheets = parseSheetsFromBuffer(fileBuffer, ext)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to parse file'
        res.status(422).json({ error: `File parse error: ${msg}` })
        return resolve()
      }

      if (!sheets.length) {
        res.status(422).json({ error: 'No sheets found in file' })
        return resolve()
      }

      const totalRows = sheets.reduce((s, sh) => s + sh.row_count, 0)
      const db = createAdminClient()

      // Store file in Supabase Storage
      const { data: batchRow, error: insertErr } = await db
        .from('upload_batches')
        .insert({
          source_filename: fileName,
          filename: fileName,
          detected_format: ext,
          sheets,
          total_rows: totalRows,
          row_count: totalRows,
          account_id: accountId,
          client_id: clientId,
          batch_tag: batchTag,
          status: 'parsed',
          uploaded_by: auth.userId ?? null,
          raw_data: [],
          column_mapping: {},
        })
        .select('upload_batch_id')
        .single()

      if (insertErr || !batchRow) {
        res.status(500).json({ error: insertErr?.message ?? 'DB insert failed' })
        return resolve()
      }

      const batchId: string = batchRow.upload_batch_id
      const filePath = `${batchId}/source.${ext}`

      const { error: storageErr } = await db.storage
        .from('upload-batches')
        .upload(filePath, fileBuffer, {
          contentType: ext === 'csv' ? 'text/csv' : 'application/octet-stream',
          upsert: true,
        })

      if (storageErr) {
        // Non-fatal: batch row exists, file path just won't work for Edge Function
        console.error('Storage upload failed:', storageErr.message)
      } else {
        await db
          .from('upload_batches')
          .update({ file_path: filePath })
          .eq('upload_batch_id', batchId)
      }

      res.status(200).json({
        batch_id: batchId,
        status: 'parsed',
        detected_format: ext,
        sheets,
        total_rows: totalRows,
      })
      resolve()
    })

    bb.on('error', (err: Error) => {
      res.status(500).json({ error: err.message })
      resolve()
    })

    req.pipe(bb)
  })
}
