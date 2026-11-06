import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { resolveClientIdsList } from '../../_lib/clients/resolve-client-ids.js'

// PUBLIC (no-auth) read endpoint for the client map share link.
// SECURITY: returns ONLY name/brand + lat/lng points + branch lat/lng.
// Never select or return cost/price/mcv/contract/revenue/risk columns.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const tokenRaw = req.query.token
  const token = Array.isArray(tokenRaw) ? tokenRaw[0] : tokenRaw
  if (!token) return res.status(404).json({ error: 'not_found' })

  const db = createAdminClient()

  const { data: client, error: clientErr } = await db
    .from('clients')
    .select('id, account_id, name, display_name, brand_color, share_expires_at')
    .eq('share_token', token)
    .maybeSingle()
  if (clientErr) return res.status(500).json({ error: 'internal_error' })
  if (!client) return res.status(404).json({ error: 'not_found' })

  if (client.share_expires_at && new Date(client.share_expires_at) < new Date()) {
    return res.status(410).json({ error: 'expired' })
  }

  // Resolve combined clients to members (pass-through for normal clients).
  const ids = await resolveClientIdsList(db, [client.id])

  // Page service_locations (PostgREST caps ~1000 rows per response).
  const SL_PAGE = 1000
  const MAX_SL_PAGES = 100
  const propIdSet = new Set<string>()
  for (let page = 0; page < MAX_SL_PAGES; page++) {
    const from = page * SL_PAGE
    const { data: sls, error: slErr } = await db
      .from('service_locations')
      .select('property_id')
      .in('client_id', ids)
      .range(from, from + SL_PAGE - 1)
    if (slErr) return res.status(500).json({ error: 'internal_error' })
    const batch = sls ?? []
    for (const r of batch) {
      const pid = (r as any).property_id
      if (pid) propIdSet.add(pid)
    }
    if (batch.length < SL_PAGE) break
  }

  const propIds = Array.from(propIdSet)
  const points: Array<{ id: string; lat: number; lng: number }> = []
  const PROP_CHUNK = 200
  for (let i = 0; i < propIds.length; i += PROP_CHUNK) {
    const chunk = propIds.slice(i, i + PROP_CHUNK)
    const { data: props, error: pErr } = await db
      .from('properties')
      .select('id, latitude, longitude')
      .in('id', chunk)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
    if (pErr) return res.status(500).json({ error: 'internal_error' })
    for (const p of props ?? []) {
      points.push({ id: (p as any).id, lat: (p as any).latitude, lng: (p as any).longitude })
    }
  }

  // The client's own committed branch selection.
  const { data: oc, error: ocErr } = await db
    .from('account_operational_constraints')
    .select('selected_branches')
    .eq('account_id', client.account_id)
    .eq('client_id', client.id)
    .maybeSingle()
  if (ocErr) return res.status(500).json({ error: 'internal_error' })
  const sel = Array.isArray((oc as any)?.selected_branches) ? (oc as any).selected_branches : []
  const branches = sel
    .filter((b: any) => b && b.lat != null && b.lng != null)
    .map((b: any) => ({ name: b.name, lat: b.lat, lng: b.lng }))

  return res.status(200).json({
    client: { name: client.name, display_name: client.display_name, brand_color: client.brand_color },
    points,
    branches,
  })
}
