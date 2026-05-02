// GET /api/accounts/[accountId]/overview
// Phase 3.6 — aggregate stats + per-client summary for the Account Overview
// page. The page renders:
//   - Top-level: client_count, total_properties, total_service_locations,
//     unique_states, last_activity_at
//   - Per-client cards: property_count, service_location_count, states_count,
//     last_analysis_at, synthesis_status (fresh / stale / never), branch
//     selection summary (selected_k + city_state list)
//
// Most fields are summed/grouped client-side from a few targeted queries —
// none of this needs to be real-time so we don't bother with materialized views.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const accountId = req.query.accountId as string
  const db = createAdminClient()

  // Account row
  const { data: account, error: accErr } = await db
    .from('accounts')
    .select('id, name, display_name, account_type, status, brand_color, logo_url')
    .eq('id', accountId)
    .maybeSingle()
  if (accErr) return res.status(500).json({ error: accErr.message })
  if (!account) return res.status(404).json({ error: 'Account not found' })

  // Clients on this account (includes combined clients hosted here).
  const { data: clientRows } = await db
    .from('clients')
    .select('id, name, display_name, status, is_combined, member_client_ids')
    .eq('account_id', accountId)
    .order('name', { ascending: true })
  const clients = (clientRows ?? []) as Array<{
    id: string
    name: string
    display_name: string | null
    status: string
    is_combined: boolean | null
    member_client_ids: string[] | null
  }>
  const clientIds = clients.map((c) => c.id)
  // Combined clients own no SLs of their own — their property/SL counts
  // come from member clients (which can live in other accounts). Pull
  // SLs for every referenced member id too so the rollup is complete.
  const memberIds = new Set<string>()
  for (const c of clients) {
    if (c.is_combined && Array.isArray(c.member_client_ids)) {
      for (const m of c.member_client_ids) memberIds.add(m)
    }
  }
  const allClientIdsForSlPull = Array.from(new Set([...clientIds, ...memberIds]))

  // Service locations grouped by client (counts + property_id list per client).
  // Pull for every referenced client id including cross-account members so
  // combined-client rollups are complete.
  const slByClient = new Map<string, { propIds: Set<string>; slCount: number }>()
  if (allClientIdsForSlPull.length) {
    const PAGE = 1000
    for (let p = 0; p < 50; p++) {
      const { data: slRows } = await db
        .from('service_locations')
        .select('id, property_id, client_id')
        .in('client_id', allClientIdsForSlPull)
        .not('property_id', 'is', null)
        .range(p * PAGE, p * PAGE + PAGE - 1)
      const batch = (slRows ?? []) as any[]
      for (const r of batch) {
        const cur = slByClient.get(r.client_id) ?? { propIds: new Set<string>(), slCount: 0 }
        cur.slCount += 1
        cur.propIds.add(r.property_id)
        slByClient.set(r.client_id, cur)
      }
      if (batch.length < PAGE) break
    }
  }

  // Pull every property referenced (one query) for state breakdown per client
  const allPropIds = new Set<string>()
  for (const v of slByClient.values()) for (const id of v.propIds) allPropIds.add(id)
  const stateById = new Map<string, string>()
  if (allPropIds.size) {
    const { data: propRows } = await db
      .from('properties')
      .select('id, state')
      .in('id', Array.from(allPropIds))
    for (const r of (propRows ?? []) as any[]) {
      if (r.state) stateById.set(r.id, String(r.state).toUpperCase())
    }
  }

  // Per-client analysis activity in one batched query
  const analysisByClient = new Map<
    string,
    { last_analysis_at: string | null; last_synthesis_at: string | null; synthesis_status: 'fresh' | 'stale' | 'never' }
  >()
  if (clientIds.length) {
    const { data: anaRows } = await db
      .from('portfolio_analyses')
      .select('client_id, module_key, status, completed_at, created_at')
      .eq('account_id', accountId)
      .in('client_id', clientIds)
      .order('created_at', { ascending: false })
      .limit(500)
    for (const r of (anaRows ?? []) as any[]) {
      const cur =
        analysisByClient.get(r.client_id) ??
        { last_analysis_at: null, last_synthesis_at: null, synthesis_status: 'never' as const }
      const ts = r.completed_at ?? r.created_at
      if (!cur.last_analysis_at || (ts && ts > cur.last_analysis_at)) cur.last_analysis_at = ts
      if (r.module_key === 'synthesis') {
        if (!cur.last_synthesis_at || (ts && ts > cur.last_synthesis_at)) {
          cur.last_synthesis_at = ts
          cur.synthesis_status =
            r.status === 'stale' ? 'stale' : r.status === 'completed' ? 'fresh' : cur.synthesis_status
        }
      }
      analysisByClient.set(r.client_id, cur)
    }
  }

  // Per-client branch selection (from operational_constraints)
  const selectionByClient = new Map<
    string,
    { selected_k: number | null; selected_branches: Array<{ city_state: string }> | null }
  >()
  if (clientIds.length) {
    const { data: aocRows } = await db
      .from('account_operational_constraints')
      .select('client_id, selected_k, selected_branches')
      .eq('account_id', accountId)
      .in('client_id', clientIds)
    for (const r of (aocRows ?? []) as any[]) {
      const branches: any[] | null = Array.isArray(r.selected_branches) ? r.selected_branches : null
      selectionByClient.set(r.client_id, {
        selected_k: r.selected_k ?? null,
        selected_branches: branches?.map((b) => ({ city_state: b.city_state ?? b.name ?? '' })) ?? null,
      })
    }
  }

  // Build per-client payload. For combined clients, fan out to members
  // and sum their counts.
  const clientsOut = clients.map((c) => {
    const isCombined = c.is_combined === true && Array.isArray(c.member_client_ids)
    const sourceIds = isCombined ? (c.member_client_ids as string[]) : [c.id]
    const props = new Set<string>()
    let slCount = 0
    for (const sid of sourceIds) {
      const sl = slByClient.get(sid)
      if (!sl) continue
      slCount += sl.slCount
      for (const pid of sl.propIds) props.add(pid)
    }
    const states = new Set<string>()
    for (const pid of props) {
      const s = stateById.get(pid)
      if (s) states.add(s)
    }
    const ana = analysisByClient.get(c.id) ?? {
      last_analysis_at: null,
      last_synthesis_at: null,
      synthesis_status: 'never' as const,
    }
    const sel = selectionByClient.get(c.id) ?? { selected_k: null, selected_branches: null }
    return {
      id: c.id,
      name: c.name,
      display_name: c.display_name,
      status: c.status,
      is_combined: isCombined,
      member_count: isCombined ? sourceIds.length : null,
      property_count: props.size,
      service_location_count: slCount,
      states_count: states.size,
      last_analysis_at: ana.last_analysis_at,
      last_synthesis_at: ana.last_synthesis_at,
      synthesis_status: ana.synthesis_status,
      branch_selection: sel,
    }
  })

  // Account-level rollups — exclude combined clients to avoid
  // double-counting members that also live in this account.
  const totalProperties = clientsOut
    .filter((c) => !c.is_combined)
    .reduce((sum, c) => sum + c.property_count, 0)
  const totalServiceLocations = clientsOut
    .filter((c) => !c.is_combined)
    .reduce((sum, c) => sum + c.service_location_count, 0)
  const allStates = new Set<string>()
  for (const c of clientsOut) {
    // Recompute per client from stateById (cheap)
    const sl = slByClient.get(c.id)
    if (!sl) continue
    for (const pid of sl.propIds) {
      const s = stateById.get(pid)
      if (s) allStates.add(s)
    }
  }
  const lastActivity = clientsOut
    .map((c) => c.last_analysis_at)
    .filter((t): t is string => !!t)
    .sort()
    .pop() ?? null

  return res.status(200).json({
    account: {
      id: account.id,
      name: account.name,
      display_name: (account as any).display_name,
      account_type: (account as any).account_type,
      status: (account as any).status,
      brand_color: (account as any).brand_color,
      logo_url: (account as any).logo_url,
    },
    client_count: clientsOut.length,
    total_properties: totalProperties,
    total_service_locations: totalServiceLocations,
    unique_states: allStates.size,
    last_activity_at: lastActivity,
    clients: clientsOut,
  })
}
