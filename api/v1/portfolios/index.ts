import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase'
import { authenticateRequest } from '../../_lib/auth'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  let ctx: Awaited<ReturnType<typeof authenticateRequest>>
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const db = createAdminClient()

  if (req.method === 'GET') {
    const { client_id } = req.query

    // Service-key callers must scope to a client
    if (ctx.mode === 'service' && !client_id) {
      return res.status(400).json({ error: 'client_id is required for service-key auth' })
    }

    let query = db
      .from('portfolios')
      .select('*')
      .order('created_at', { ascending: false })

    if (client_id) query = query.eq('client_id', String(client_id))

    const { data, error } = await query
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data ?? [])
  }

  if (req.method === 'POST') {
    const {
      name,
      portfolio_type = 'custom',
      client_id,
      bid_id,
      service_location_ids,
    } = req.body ?? {}

    if (!name) return res.status(400).json({ error: 'name required' })

    const VALID_TYPES = ['client', 'prospect', 'bid', 'region', 'custom']
    if (!VALID_TYPES.includes(portfolio_type)) {
      return res.status(400).json({ error: `portfolio_type must be one of: ${VALID_TYPES.join(', ')}` })
    }

    const { data: portfolio, error } = await db
      .from('portfolios')
      .insert({
        name,
        portfolio_type,
        client_id: client_id ?? null,
        bid_id: bid_id ?? null,
        created_by: ctx.userId ?? null,
      })
      .select('portfolio_id')
      .single()

    if (error) return res.status(500).json({ error: error.message })

    // Link service locations via their parent property_id
    if (service_location_ids?.length) {
      const { data: sls } = await db
        .from('service_locations')
        .select('property_id')
        .in('service_location_id', service_location_ids)

      if (sls?.length) {
        const propIds = [...new Set(sls.map((sl: any) => sl.property_id))]
        await db.from('portfolio_locations').insert(
          propIds.map((pid) => ({
            portfolio_id: portfolio.portfolio_id,
            property_id: pid,
          }))
        )
      }
    }

    return res.status(201).json({ portfolio_id: portfolio.portfolio_id })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
