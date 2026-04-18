import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase'
import { verifyAuth, unauthorized } from '../../_lib/auth'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  const auth = await verifyAuth(req)
  if (!auth.ok) return unauthorized(res, auth.error)

  const db = createAdminClient()

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('portfolios')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data ?? [])
  }

  if (req.method === 'POST') {
    const { name, description, property_ids } = req.body ?? {}
    if (!name) return res.status(400).json({ error: 'name required' })

    const { data: portfolio, error } = await db
      .from('portfolios')
      .insert({ name, description, created_by: auth.userId })
      .select('portfolio_id')
      .single()

    if (error) return res.status(500).json({ error: error.message })

    // Add property memberships
    if (property_ids?.length) {
      await db.from('portfolio_locations').insert(
        property_ids.map((pid: string) => ({
          portfolio_id: portfolio.portfolio_id,
          property_id: pid,
        }))
      )
    }

    return res.status(201).json(portfolio)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
