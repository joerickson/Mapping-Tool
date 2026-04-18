import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { token } = req.query
  const db = createAdminClient()

  const { data: portfolio, error } = await db
    .from('portfolios')
    .select('portfolio_id, name, description, share_expires_at, share_financials_enabled')
    .eq('share_token', token)
    .single()

  if (error || !portfolio) return res.status(404).json({ error: 'Not found' })

  // Check expiry
  if (portfolio.share_expires_at && new Date(portfolio.share_expires_at) < new Date()) {
    return res.status(410).json({ error: 'Link expired' })
  }

  const { data: memberships } = await db
    .from('portfolio_locations')
    .select('property_id')
    .eq('portfolio_id', portfolio.portfolio_id)

  const propertyIds = memberships?.map((m: any) => m.property_id) ?? []

  let properties: any[] = []
  if (propertyIds.length) {
    const { data } = await db
      .from('properties')
      .select('property_id, address_line1, address_line2, city, state, postal_code, rbm_category, building_sqft, service_locations(service_location_id, display_name, location_code, serviceable_sqft, status)')
      .in('property_id', propertyIds)
    properties = data ?? []
  }

  return res.status(200).json({ portfolio, properties })
}
