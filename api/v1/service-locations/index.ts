import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase'
import { authenticateRequest } from '../../_lib/auth'
import { fireWebhook } from '../../_lib/webhooks'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  let ctx: Awaited<ReturnType<typeof authenticateRequest>>
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const db = createAdminClient()

  // ── GET /api/v1/service-locations ─────────────────────────────────────────
  if (req.method === 'GET') {
    const { client_id, status, property_id, portfolio_id } = req.query

    let query = db
      .from('service_locations')
      .select('*, property:properties(state, city)')
      .order('property(state)', { ascending: true })

    if (client_id) query = query.in('client_id', String(client_id).split(','))
    if (status) query = query.in('status', String(status).split(','))
    if (property_id) query = query.eq('property_id', String(property_id))

    if (portfolio_id) {
      // portfolio_locations can link via property_id or directly via service_location_id
      const { data: members } = await db
        .from('portfolio_locations')
        .select('property_id')
        .eq('portfolio_id', String(portfolio_id))
      const propIds = (members ?? []).map((m: any) => m.property_id).filter(Boolean)
      if (!propIds.length) return res.status(200).json([])
      query = query.in('property_id', propIds)
    }

    const { data, error } = await query
    if (error) return res.status(500).json({ error: error.message })

    // Sort by state, city, display_name in JS since Supabase sort on joined table is limited
    const sorted = (data ?? []).sort((a: any, b: any) => {
      const stateA = a.property?.state ?? ''
      const stateB = b.property?.state ?? ''
      if (stateA !== stateB) return stateA.localeCompare(stateB)
      const cityA = a.property?.city ?? ''
      const cityB = b.property?.city ?? ''
      if (cityA !== cityB) return cityA.localeCompare(cityB)
      return (a.display_name ?? '').localeCompare(b.display_name ?? '')
    })

    return res.status(200).json(sorted)
  }

  // ── POST /api/v1/service-locations ────────────────────────────────────────
  if (req.method === 'POST') {
    const {
      property_id,
      display_name,
      client_id,
      location_code,
      suite_or_floor,
      serviceable_sqft,
      service_frequency,
      service_schedule,
      monthly_contract_value,
      winteam_job_number,
      status = 'active',
    } = req.body ?? {}

    if (!property_id) return res.status(400).json({ error: 'property_id required' })
    if (!display_name) return res.status(400).json({ error: 'display_name required' })

    // Uniqueness on (client_id, location_code) when both are set
    if (client_id && location_code) {
      const { data: conflict } = await db
        .from('service_locations')
        .select('service_location_id')
        .eq('client_id', client_id)
        .eq('location_code', location_code)
        .maybeSingle()

      if (conflict) {
        return res.status(409).json({
          error: 'A service location with this client_id and location_code already exists',
          service_location_id: conflict.service_location_id,
        })
      }
    }

    const { data, error } = await db
      .from('service_locations')
      .insert({
        property_id,
        display_name,
        client_id: client_id ?? null,
        location_code: location_code ?? null,
        suite_or_floor: suite_or_floor ?? null,
        serviceable_sqft: serviceable_sqft ?? null,
        service_frequency: service_frequency ?? null,
        service_schedule: service_schedule ?? null,
        monthly_contract_value: monthly_contract_value ?? null,
        winteam_job_number: winteam_job_number ?? null,
        status,
      })
      .select('service_location_id')
      .single()

    if (error) return res.status(500).json({ error: error.message })

    fireWebhook('service_location.created', {
      service_location_id: data.service_location_id,
      property_id,
      client_id: client_id ?? null,
    }).catch(() => {})

    return res.status(201).json({ service_location_id: data.service_location_id })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
