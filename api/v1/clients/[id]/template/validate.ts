import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../../_lib/supabase.js'
import { authenticateRequest } from '../../../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const clientId = req.query.id as string
  const { columns, sheet_names, sample_rows } = req.body ?? {}

  if (!columns?.length) return res.status(400).json({ error: 'columns is required' })

  const db = createAdminClient()

  // Load template and service offerings for this client
  const [{ data: template }, { data: offerings }] = await Promise.all([
    db.from('client_templates').select('*').eq('client_id', clientId).single(),
    db.from('service_offerings').select('id, name').eq('client_id', clientId).eq('is_archived', false),
  ])

  const columnMapping = (template?.upload_column_mapping ?? {}) as Record<string, { target: string; required?: boolean }>
  const sheetMapping = (template?.sheet_to_offering_mapping ?? {}) as Record<string, string>

  const mappedCols = columns.filter((c: string) => columnMapping[c])
  const mappedSheets = (sheet_names ?? []).filter((s: string) => {
    return Object.keys(sheetMapping).some((pat) => {
      if (pat.includes('*')) {
        const re = new RegExp('^' + pat.replace(/\*/g, '.*') + '$', 'i')
        return re.test(s)
      }
      return pat.toLowerCase() === s.toLowerCase()
    })
  })

  // Validate sample rows
  const sampleResults = { valid: 0, invalid: 0, issues: [] as string[] }
  if (sample_rows?.length) {
    for (const row of sample_rows as Record<string, unknown>[]) {
      const mapped: Record<string, unknown> = {}
      for (const [src, def] of Object.entries(columnMapping)) {
        mapped[def.target] = row[src]
      }
      // Basic required field check
      const missing = Object.entries(columnMapping)
        .filter(([, def]) => def.required && !mapped[def.target])
        .map(([src]) => src)
      if (missing.length) {
        sampleResults.invalid++
        if (sampleResults.issues.length < 5) {
          sampleResults.issues.push(`Missing required: ${missing.join(', ')}`)
        }
      } else {
        sampleResults.valid++
      }
    }
  }

  return res.status(200).json({
    columns_total: columns.length,
    columns_mapped: mappedCols.length,
    sheets_total: (sheet_names ?? []).length,
    sheets_mapped: mappedSheets.length,
    sample_rows_total: sample_rows?.length ?? 0,
    sample_rows_valid: sampleResults.valid,
    sample_rows_invalid: sampleResults.invalid,
    sample_issues: sampleResults.issues,
    offerings_available: (offerings ?? []).map((o: { id: string; name: string }) => ({ id: o.id, name: o.name })),
  })
}
