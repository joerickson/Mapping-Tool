// POST /api/v1/clients/[id]/sync-combined
//
// For combined clients only. Pulls aggregate state from each member
// client into the combined client's own account_operational_constraints
// so it behaves like a normal client for downstream tooling (Branch
// Optimization, scheduler, etc.):
//
//  - selected_branches  — union across members, dedupe by rounded lat/lng
//  - crew_count_per_branch_override — sum per-branch contributions
//
// Properties / SLs / offerings are NOT copied; reads use the resolver
// helper to fan out to member ids on the fly.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'
import {
  loadConstraints,
  type SelectedBranch,
} from '../../../_lib/analysis/operational-constraints.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let ctx: Awaited<ReturnType<typeof authenticateRequest>>
  try { ctx = await authenticateRequest(req) } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const clientId = req.query.id as string
  const db = createAdminClient()

  // Look up the combined client + its members.
  const { data: client, error: cliErr } = await db
    .from('clients')
    .select('id, account_id, is_combined, member_client_ids, metadata')
    .eq('id', clientId)
    .maybeSingle()
  if (cliErr) return res.status(500).json({ error: cliErr.message })
  if (!client) return res.status(404).json({ error: 'Client not found' })
  const c = client as {
    id: string
    account_id: string
    is_combined: boolean
    member_client_ids: string[] | null
    metadata: Record<string, unknown> | null
  }
  if (!c.is_combined || !Array.isArray(c.member_client_ids) || c.member_client_ids.length < 2) {
    return res.status(400).json({ error: 'Client is not a combined client' })
  }

  // Each member may live under a different account.
  const { data: memberRows, error: memErr } = await db
    .from('clients')
    .select('id, account_id, name, display_name')
    .in('id', c.member_client_ids)
  if (memErr) return res.status(500).json({ error: memErr.message })
  const members = (memberRows ?? []) as Array<{
    id: string; account_id: string; name: string; display_name: string | null
  }>

  // Aggregate branches + per-branch crew counts across members.
  const byKey = new Map<string, { branch: SelectedBranch; sources: string[] }>()
  const crewByBranchName: Record<string, number> = {}
  const memberSummaries: Array<{ client_id: string; client_name: string; branches: number; crews: number }> = []
  let totalCrewSum = 0

  for (const m of members) {
    const cons = await loadConstraints(db, m.account_id, m.id)
    const sel = cons.selected_branches ?? []
    let memberCrews = 0
    for (const b of sel) {
      const k = `${b.lat.toFixed(3)},${b.lng.toFixed(3)}`
      const existing = byKey.get(k)
      if (existing) {
        if (!existing.sources.includes(m.id)) existing.sources.push(m.id)
      } else {
        byKey.set(k, { branch: { ...b }, sources: [m.id] })
      }
      const perBranch = cons.crew_count_per_branch_override?.[b.name] ?? 0
      if (perBranch > 0) {
        crewByBranchName[b.name] = (crewByBranchName[b.name] ?? 0) + perBranch
        memberCrews += perBranch
      }
    }
    totalCrewSum += memberCrews
    memberSummaries.push({
      client_id: m.id,
      client_name: m.display_name ?? m.name,
      branches: sel.length,
      crews: memberCrews,
    })
  }

  const mergedBranches: SelectedBranch[] = Array.from(byKey.values()).map((v) => v.branch)
  const syncedAt = new Date().toISOString()

  // Upsert into the combined client's constraints row.
  const { error: upErr } = await db
    .from('account_operational_constraints')
    .upsert(
      {
        account_id: c.account_id,
        client_id: c.id,
        selected_branches: mergedBranches,
        selected_k: mergedBranches.length,
        selected_at: syncedAt,
        crew_count_per_branch_override:
          Object.keys(crewByBranchName).length > 0 ? crewByBranchName : null,
        updated_at: syncedAt,
        updated_by: ctx.userId ?? null,
      },
      { onConflict: 'account_id,client_id' }
    )
  if (upErr) return res.status(500).json({ error: `constraints upsert failed: ${upErr.message}` })

  // Stamp the sync timestamp on clients.metadata.
  const newMeta = { ...(c.metadata ?? {}), combined_last_synced_at: syncedAt }
  await db.from('clients').update({ metadata: newMeta }).eq('id', c.id)

  return res.status(200).json({
    synced_at: syncedAt,
    branches: mergedBranches.length,
    branches_dedup: mergedBranches,
    crew_total: totalCrewSum,
    crew_by_branch: crewByBranchName,
    members: memberSummaries,
  })
}
