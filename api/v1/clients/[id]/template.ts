import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const clientId = req.query.id as string
  const db = createAdminClient()

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('client_templates')
      .select('*')
      .eq('client_id', clientId)
      .single()

    if (error?.code === 'PGRST116') {
      // No template yet — return empty default
      return res.status(200).json({
        client_id: clientId,
        upload_column_mapping: {},
        sheet_to_offering_mapping: {},
        default_country: null,
        is_configured: false,
        notes: null,
      })
    }
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data)
  }

  if (req.method === 'PUT') {
    const {
      upload_column_mapping, sheet_to_offering_mapping,
      default_country, is_configured, notes,
    } = req.body ?? {}

    const { data: existing } = await db
      .from('client_templates')
      .select('id')
      .eq('client_id', clientId)
      .single()

    const payload = {
      client_id: clientId,
      upload_column_mapping: upload_column_mapping ?? {},
      sheet_to_offering_mapping: sheet_to_offering_mapping ?? {},
      default_country: default_country ?? null,
      is_configured: is_configured ?? false,
      notes: notes ?? null,
    }

    let data, error
    if (existing) {
      ;({ data, error } = await db
        .from('client_templates')
        .update(payload)
        .eq('client_id', clientId)
        .select('*')
        .single())
    } else {
      ;({ data, error } = await db
        .from('client_templates')
        .insert(payload)
        .select('*')
        .single())
    }

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
