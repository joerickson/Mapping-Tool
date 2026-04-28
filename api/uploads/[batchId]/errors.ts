import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string }
    return res.status(e.statusCode ?? 401).json({ error: e.message ?? 'Unauthorized' })
  }

  const batchId = req.query.batchId as string
  const db = createAdminClient()

  const { data: rows, error } = await db
    .from('upload_staged_rows')
    .select('sheet_name, row_index, property_data, service_location_data, error_messages')
    .eq('upload_batch_id', batchId)
    .eq('outcome', 'invalid')
    .order('sheet_name')
    .order('row_index')

  if (error) return res.status(500).json({ error: error.message })
  if (!rows || rows.length === 0) {
    return res.status(200).setHeader('Content-Type', 'text/csv').send('sheet,row,errors\n')
  }

  // Build CSV
  const allAddressKeys = ['address_line1', 'address_line2', 'city', 'state', 'postal_code', 'country']
  const allSlKeys = ['display_name', 'suite_or_floor', 'serviceable_sqft', 'frequency_notes']

  const header = ['Sheet', 'Row', 'Errors', ...allAddressKeys, ...allSlKeys]
  const csvRows: string[][] = [header]

  for (const row of rows) {
    const pd = (row.property_data ?? {}) as Record<string, unknown>
    const sld = (row.service_location_data ?? {}) as Record<string, unknown>
    const errors = (row.error_messages ?? []).join('; ')
    csvRows.push([
      row.sheet_name,
      String((row.row_index ?? 0) + 2), // +2: 1-based + header row
      errors,
      ...allAddressKeys.map((k) => String(pd[k] ?? '')),
      ...allSlKeys.map((k) => String(sld[k] ?? '')),
    ])
  }

  const csv = csvRows
    .map((cols) => cols.map((c) => JSON.stringify(c)).join(','))
    .join('\n')

  res
    .status(200)
    .setHeader('Content-Type', 'text/csv')
    .setHeader('Content-Disposition', `attachment; filename="errors_${batchId}.csv"`)
    .send(csv)
}
