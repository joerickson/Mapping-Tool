import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'
import { createAdminClient } from '../../_lib/supabase'
import { verifyAuth, unauthorized } from '../../_lib/auth'
import { fireWebhook } from '../../_lib/webhooks'

function hashAddress(addr: string, city: string, state: string, zip: string): string {
  const normalized = [addr, city, state, zip]
    .map((s) => s.trim().toLowerCase().replace(/\s+/g, ' '))
    .join('|')
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  const auth = await verifyAuth(req)
  if (!auth.ok) return unauthorized(res, auth.error)

  const db = createAdminClient()

  if (req.method === 'GET') {
    const { client_id, category, bbox, status, portfolio_id, city_state, limit = '500', offset = '0' } = req.query

    let query = db
      .from('properties')
      .select(`
        *,
        service_locations (*)
      `)
      .range(Number(offset), Number(offset) + Number(limit) - 1)

    if (category) {
      const cats = String(category).split(',')
      query = query.in('rbm_category', cats)
    }

    if (client_id) {
      const ids = String(client_id).split(',')
      query = query.in('service_locations.client_id', ids)
    }

    if (bbox) {
      const [lat1, lng1, lat2, lng2] = String(bbox).split(',').map(Number)
      query = query
        .gte('latitude', Math.min(lat1, lat2))
        .lte('latitude', Math.max(lat1, lat2))
        .gte('longitude', Math.min(lng1, lng2))
        .lte('longitude', Math.max(lng1, lng2))
    }

    if (city_state) {
      const parts = String(city_state).split(',').map((s) => s.trim())
      if (parts[0]) query = query.ilike('city', `%${parts[0]}%`)
      if (parts[1]) query = query.ilike('state', `%${parts[1]}%`)
    }

    if (status) {
      const statuses = String(status).split(',')
      query = query.in('service_locations.status', statuses)
    }

    if (portfolio_id) {
      const pids = String(portfolio_id).split(',')
      const { data: memberships } = await db
        .from('portfolio_locations')
        .select('property_id')
        .in('portfolio_id', pids)
      const propIds = memberships?.map((m: any) => m.property_id) ?? []
      if (propIds.length) query = query.in('property_id', propIds)
      else return res.status(200).json({ properties: [], total: 0 })
    }

    const { data, error, count } = await query
    if (error) return res.status(500).json({ error: error.message })

    return res.status(200).json({ properties: data ?? [], total: count ?? 0 })
  }

  if (req.method === 'POST') {
    const items = Array.isArray(req.body) ? req.body : [req.body]
    const results = []

    for (const item of items) {
      const { address_line1, city, state, postal_code, address_line2, ...rest } = item
      if (!address_line1 || !city || !state || !postal_code) {
        results.push({ error: 'address_line1, city, state, postal_code required' })
        continue
      }

      const addressHash = hashAddress(address_line1, city, state, postal_code)

      const { data: existing } = await db
        .from('properties')
        .select('property_id, last_enriched_at')
        .eq('address_hash', addressHash)
        .maybeSingle()

      let property: any
      if (existing) {
        const { data: updated } = await db
          .from('properties')
          .update({ ...rest, updated_at: new Date().toISOString() })
          .eq('property_id', existing.property_id)
          .select()
          .single()
        property = updated
        await fireWebhook('property.updated', {
          property_id: existing.property_id,
          changed_fields: Object.keys(rest),
          changed_by: auth.userId,
        })
      } else {
        const { data: created, error: createErr } = await db
          .from('properties')
          .insert({
            address_line1,
            address_line2: address_line2 ?? null,
            city,
            state: state.toUpperCase(),
            postal_code,
            address_hash: addressHash,
            enrichment_status: 'pending',
            ...rest,
          })
          .select()
          .single()

        if (createErr) {
          results.push({ error: createErr.message })
          continue
        }
        property = created
      }

      results.push(property)
    }

    return res.status(200).json(results.length === 1 ? results[0] : results)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
