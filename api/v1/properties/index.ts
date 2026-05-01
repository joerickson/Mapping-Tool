import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'
import { fireWebhook } from '../../_lib/webhooks.js'

function hashAddress(addr: string, city: string, state: string, zip: string): string {
  const normalized = [addr, city, state, zip]
    .map((s) => s.trim().toLowerCase().replace(/\s+/g, ' '))
    .join('|')
  return crypto.createHash('sha256').update(normalized).digest('hex')
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  let ctx: Awaited<ReturnType<typeof authenticateRequest>>
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const db = createAdminClient()

  // ── GET /api/v1/properties ────────────────────────────────────────────────
  if (req.method === 'GET') {
    const {
      client_id,
      category,
      bbox,
      city,
      state,
      city_state,
      status,
      portfolio_id,
      enrichment_status,
      custom_filter,
      limit: limitParam = '100',
      offset: offsetParam = '0',
    } = req.query

    // Parse custom_filter — JSON-encoded { field_key: string | string[] }.
    // Strings → ilike contains; arrays → any-of (overlap-style match).
    // Empty / unparseable → ignored.
    let customFilter: Record<string, string | string[]> | null = null
    if (custom_filter) {
      try {
        const parsed = JSON.parse(String(custom_filter))
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          customFilter = parsed
        }
      } catch {
        return res.status(400).json({ error: 'custom_filter must be JSON' })
      }
    }
    const hasCustomFilter = !!customFilter && Object.keys(customFilter).length > 0

    // Service-key callers must scope to a client
    if (ctx.mode === 'service' && !client_id) {
      return res.status(400).json({ error: 'client_id is required for service-key auth' })
    }

    const limit = Math.min(Math.max(1, Number(limitParam)), 2000)
    const offset = Math.max(0, Number(offsetParam))

    // Build list of property IDs from service_location filters
    let propIdsFromServiceLocations: string[] | null = null

    // If we have any service_location filters, query them first
    // Only apply filters if parameters have truthy values
    const hasClientFilter = client_id && String(client_id).trim().length > 0
    const hasStatusFilter = status && String(status).trim().length > 0
    const hasPortfolioFilter = portfolio_id && String(portfolio_id).trim().length > 0

    if (hasClientFilter || hasStatusFilter || hasPortfolioFilter || hasCustomFilter) {
      // Strip empty/whitespace-only ids — Postgres uuid type rejects ''
      // with a 22P02 error which would surface as a 500 here.
      const cleanIds = (csv: string) =>
        csv.split(',').map((s) => s.trim()).filter((s) => s.length > 0)

      // PostgREST silently caps responses at ~1000 rows; for accounts
      // with thousands of service_locations we MUST paginate, otherwise
      // the property-id slice we feed into the next query is incomplete
      // (the "all clients = 0 pins" bug). Loop pages until we get a
      // short page back.
      const SL_PAGE = 1000
      const propIdSet = new Set<string>()
      let slOffset = 0
      // Hard ceiling — 100 pages × 1000 rows = 100k SLs, more than any
      // legitimate portfolio. Beyond that something is wrong upstream.
      const MAX_SL_PAGES = 100
      for (let page = 0; page < MAX_SL_PAGES; page++) {
        // Pull custom_fields too when a custom_filter is present so we can
        // post-filter in JS (cleaner than betting on PostgREST jsonb syntax).
        const slSelect = hasCustomFilter ? 'property_id, custom_fields' : 'property_id'
        let slQuery = db
          .from('service_locations')
          .select(slSelect)
          .range(slOffset, slOffset + SL_PAGE - 1)
        if (hasClientFilter) {
          const ids = cleanIds(String(client_id))
          if (ids.length === 0) break
          slQuery = slQuery.in('client_id', ids)
        }
        if (hasStatusFilter) {
          const statuses = cleanIds(String(status))
          if (statuses.length === 0) break
          slQuery = slQuery.in('status', statuses)
        }
        if (hasPortfolioFilter) {
          const portfolioIds = cleanIds(String(portfolio_id))
          if (portfolioIds.length === 0) break
          slQuery = slQuery.overlaps('portfolio_ids', portfolioIds)
        }
        const { data: sls, error: slError } = await slQuery
        if (slError) {
          return res
            .status(500)
            .json({ error: `Service location query failed: ${slError.message}` })
        }
        const batch = sls ?? []
        for (const r of batch) {
          const row = r as any
          const id = row.property_id
          if (!id) continue
          if (hasCustomFilter && customFilter) {
            const cf = (row.custom_fields ?? {}) as Record<string, unknown>
            let pass = true
            for (const [key, expected] of Object.entries(customFilter)) {
              const actual = cf[key]
              if (Array.isArray(expected)) {
                if (expected.length === 0) continue
                if (actual == null || !expected.map(String).includes(String(actual))) {
                  pass = false
                  break
                }
              } else if (typeof expected === 'string') {
                const needle = expected.trim().toLowerCase()
                if (needle.length === 0) continue
                if (actual == null || !String(actual).toLowerCase().includes(needle)) {
                  pass = false
                  break
                }
              }
            }
            if (!pass) continue
          }
          propIdSet.add(id)
        }
        if (batch.length < SL_PAGE) break
        slOffset += SL_PAGE
      }
      propIdsFromServiceLocations = Array.from(propIdSet)

      if (propIdsFromServiceLocations.length === 0) {
        return res.status(200).json({ properties: [], total_count: 0, has_more: false })
      }
    }

    // Apply non-id filters via a builder so we can reuse them across
    // chunked queries when propIdsFromServiceLocations is large.
    const applyOtherFilters = <T extends { in: any; gte: any; lte: any; ilike: any; or: any; eq: any }>(
      q: T
    ): T => {
      let qq: any = q
      if (category) {
        qq = qq.in('rbm_category', String(category).split(','))
      }
      if (bbox) {
        const [lat1, lng1, lat2, lng2] = String(bbox).split(',').map(Number)
        qq = qq
          .gte('latitude', Math.min(lat1, lat2))
          .lte('latitude', Math.max(lat1, lat2))
          .gte('longitude', Math.min(lng1, lng2))
          .lte('longitude', Math.max(lng1, lng2))
      }
      if (city_state) {
        const cityStateStr = String(city_state).trim()
        const parts = cityStateStr.includes(',')
          ? cityStateStr.split(',').map((s) => s.trim())
          : cityStateStr.split(/\s+/)
        if (parts.length >= 2) {
          const cityPart = parts.slice(0, -1).join(' ')
          const statePart = parts[parts.length - 1]
          qq = qq.ilike('city', `%${cityPart}%`).ilike('state', `%${statePart}%`)
        } else {
          qq = qq.or(`city.ilike.%${cityStateStr}%,state.ilike.%${cityStateStr}%`)
        }
      } else {
        if (city) qq = qq.ilike('city', `%${String(city)}%`)
        if (state) qq = qq.ilike('state', `%${String(state)}%`)
      }
      if (enrichment_status) qq = qq.eq('enrichment_status', enrichment_status)
      return qq as T
    }

    let allProperties: any[] = []
    let total_count = 0

    if (propIdsFromServiceLocations) {
      // Chunk the .in('id', ...) so we never exceed PostgREST's URL
      // limit (~32KB). 250 UUIDs ≈ 9KB of URL — safe headroom for
      // other filters + headers. Selecting multiple clients with
      // many combined properties used to push the .in() URL past the
      // limit and return 400 Bad Request.
      const PROP_ID_CHUNK = 250
      const seen = new Set<string>()
      for (let i = 0; i < propIdsFromServiceLocations.length; i += PROP_ID_CHUNK) {
        const chunk = propIdsFromServiceLocations.slice(i, i + PROP_ID_CHUNK)
        let chunkQuery = db
          .from('properties')
          .select('*, service_locations(*)')
          .in('id', chunk)
        chunkQuery = applyOtherFilters(chunkQuery)
        const { data: chunkData, error: chunkErr } = await chunkQuery
        if (chunkErr) {
          return res.status(500).json({ error: chunkErr.message })
        }
        for (const row of chunkData ?? []) {
          if (!seen.has((row as any).id)) {
            seen.add((row as any).id)
            allProperties.push(row)
          }
        }
      }
      // Stable sort by id so pagination across chunks is deterministic.
      allProperties.sort((a, b) =>
        (a.id as string) < (b.id as string) ? -1 : (a.id as string) > (b.id as string) ? 1 : 0
      )
      total_count = allProperties.length
      // Apply caller-requested page slice.
      allProperties = allProperties.slice(offset, offset + limit)
    } else {
      // No SL-derived id filter — just paginate the properties table directly.
      let query = db
        .from('properties')
        .select('*, service_locations(*)', { count: 'exact' })
        .range(offset, offset + limit - 1)
      query = applyOtherFilters(query)
      const { data, error, count } = await query
      if (error) return res.status(500).json({ error: error.message })
      allProperties = data ?? []
      total_count = count ?? 0
    }

    // properties.id and service_locations.id are the real PK columns; alias
    // them as property_id / service_location_id for frontend compatibility.
    const properties = allProperties.map((p: any) => ({
      ...p,
      property_id: p.id,
      service_locations: (p.service_locations ?? []).map((sl: any) => ({
        ...sl,
        service_location_id: sl.id,
      })),
    }))

    // has_more must compare against the *actual* returned length, not
    // the *requested* limit. PostgREST silently caps responses at ~1000
    // rows even when limit=2000 is requested, so using the requested
    // limit causes early termination of paginated callers when total
    // is between cap and limit.
    const has_more = offset + properties.length < total_count
    return res.status(200).json({
      properties,
      total_count,
      has_more,
    })
  }

  // ── POST /api/v1/properties ───────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body ?? {}

    // Accept { properties: [...] } batch or plain array or single object
    const items: any[] = Array.isArray(body)
      ? body
      : Array.isArray(body.properties)
      ? body.properties
      : [body]

    if (items.length > 500) {
      return res.status(400).json({ error: 'Batch limit is 500 properties per call' })
    }

    const results: any[] = []
    const idsForJob: string[] = []

    for (const item of items) {
      const { address_line1, city, state, postal_code, address_line2, country = 'US', client_id, ...rest } = item

      if (!address_line1 || !city || !state || !postal_code) {
        results.push({ error: 'address_line1, city, state, postal_code required' })
        continue
      }

      const addressHash = hashAddress(address_line1, city, state, postal_code)

      const { data: existing } = await db
        .from('properties')
        .select('id, last_enriched_at, enrichment_status')
        .eq('address_hash', addressHash)
        .maybeSingle()

      let propertyId: string
      let isNew = false

      if (existing) {
        propertyId = (existing as any).id

        if (Object.keys(rest).length) {
          await db
            .from('properties')
            .update({ ...rest, updated_at: new Date().toISOString() })
            .eq('id', propertyId)
          fireWebhook('property.updated', {
            property_id: propertyId,
            changed_fields: Object.keys(rest),
            changed_by: ctx.userId ?? 'service',
          }).catch(() => {})
        }

        const enrichedAt = existing.last_enriched_at ? new Date(existing.last_enriched_at) : null
        const needsEnrichment = !enrichedAt || Date.now() - enrichedAt.getTime() > NINETY_DAYS_MS
        if (needsEnrichment) idsForJob.push(propertyId)
      } else {
        const { data: created, error: createErr } = await db
          .from('properties')
          .insert({
            address_line1,
            address_line2: address_line2 ?? null,
            city,
            state: state.trim().toUpperCase(),
            postal_code,
            country,
            address_hash: addressHash,
            enrichment_status: 'pending',
            ...rest,
          })
          .select('id')
          .single()

        if (createErr || !created) {
          results.push({ error: createErr?.message ?? 'Failed to create property' })
          continue
        }
        propertyId = (created as any).id
        isNew = true
        idsForJob.push(propertyId)
      }

      results.push({ propertyId, isNew })
    }

    // Create one enrichment job for all new/stale properties in this batch
    let enrichmentJobId: string | null = null
    if (idsForJob.length) {
      const { data: job } = await db
        .from('enrichment_jobs')
        .insert({
          property_ids: idsForJob,
          status: 'queued',
          total_properties: idsForJob.length,
          processed_properties: 0,
        })
        .select('enrichment_job_id')
        .single()
      enrichmentJobId = job?.enrichment_job_id ?? null
    }

    // Build spec-compliant response
    const response = results.map((r, i) => {
      if (r.error) return r
      const needsJob = idsForJob.includes(r.propertyId)
      return {
        property_id: r.propertyId,
        enrichment_status: r.isNew ? 'pending' : 'enriched',
        enrichment_job_id: needsJob ? enrichmentJobId : null,
        is_new: r.isNew,
      }
    })

    return res.status(200).json(response.length === 1 ? response[0] : response)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
