import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'
import { fireWebhook } from '../../_lib/webhooks.js'
import { resolveClientIdsList } from '../../_lib/clients/resolve-client-ids.js'

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

    // Service-key callers must scope to a client
    if (ctx.mode === 'service' && !client_id) {
      return res.status(400).json({ error: 'client_id is required for service-key auth' })
    }

    const buildQuery = () => {
      let q = db
        .from('service_locations')
        .select('*, property:properties(state, city)')
        .order('property(state)', { ascending: true })
      if (clientFilterIds) q = q.in('client_id', clientFilterIds)
      if (status) q = q.in('status', String(status).split(','))
      if (property_id) q = q.eq('property_id', String(property_id))
      if (portfolioPropIds) q = q.in('property_id', portfolioPropIds)
      return q
    }

    // Resolve combined-client filters + portfolio scope first so each
    // paged query has the same filter chain.
    let clientFilterIds: string[] | null = null
    if (client_id) {
      const requested = String(client_id).split(',').filter(Boolean)
      clientFilterIds = await resolveClientIdsList(db, requested)
    }
    let portfolioPropIds: string[] | null = null
    if (portfolio_id) {
      const { data: members } = await db
        .from('portfolio_locations')
        .select('property_id')
        .eq('portfolio_id', String(portfolio_id))
      const propIds = (members ?? []).map((m: any) => m.property_id).filter(Boolean)
      if (!propIds.length) return res.status(200).json([])
      portfolioPropIds = propIds
    }

    // Page through results — combined-client unions can exceed the
    // silent 1000-row PostgREST cap (4 members × ~500 SLs each = 2000+).
    const PAGE = 1000
    const data: any[] = []
    for (let p = 0; p < 50; p++) {
      const { data: batch, error } = await buildQuery().range(p * PAGE, p * PAGE + PAGE - 1)
      if (error) return res.status(500).json({ error: error.message })
      const rows = batch ?? []
      data.push(...rows)
      if (rows.length < PAGE) break
    }

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

    // Alias real PKs (id) to service_location_id / property_id for frontend compatibility.
    const aliased = sorted.map((sl: any) => ({
      ...sl,
      service_location_id: sl.id,
      property: sl.property ? { ...sl.property, property_id: sl.property.id } : null,
    }))

    return res.status(200).json(aliased)
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
        .select('id')
        .eq('client_id', client_id)
        .eq('location_code', location_code)
        .maybeSingle()

      if (conflict) {
        return res.status(409).json({
          error: 'A service location with this client_id and location_code already exists',
          service_location_id: (conflict as any).id,
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
      .select('id')
      .single()

    if (error) return res.status(500).json({ error: error.message })

    fireWebhook('service_location.created', {
      service_location_id: (data as any).id,
      property_id,
      client_id: client_id ?? null,
    }).catch(() => {})

    return res.status(201).json({ service_location_id: (data as any).id })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
