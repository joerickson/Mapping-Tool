// /api/accounts/[accountId]/select-branches
//   POST   — confirm a branch selection. Validates k matches branches.length,
//            every branch has lat/lng, and all existing_branches from the
//            account's constraints are present in the selection (matching by
//            coordinates within ~100m). Persists to
//            account_operational_constraints.selected_*.
//   DELETE — clears the selection (sets all selected_* fields to NULL) so the
//            user can redo Branch Optimization or pick a different K.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'
import {
  loadConstraints,
  SYSTEM_DEFAULTS,
  type SelectedBranch,
  type ExistingBranch,
} from '../../_lib/analysis/operational-constraints.js'

// Two coordinates within ~0.001 deg (~100m) are treated as the same branch
// when matching the user's selection against locked existing_branches.
const COORD_MATCH_TOLERANCE = 0.001

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  let ctx: Awaited<ReturnType<typeof authenticateRequest>>
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const accountId = req.query.accountId as string
  const db = createAdminClient()

  if (req.method === 'DELETE') {
    const { error } = await db
      .from('account_operational_constraints')
      .upsert(
        {
          account_id: accountId,
          selected_branches: null,
          selected_k: null,
          selected_at: null,
          selected_from_analysis_id: null,
          selected_by: null,
          updated_at: new Date().toISOString(),
          updated_by: ctx.userId ?? null,
        },
        { onConflict: 'account_id' }
      )
    if (error) return res.status(500).json({ error: error.message })
    const merged = await loadConstraints(db, accountId)
    return res.status(200).json({ ...merged, system_defaults: SYSTEM_DEFAULTS })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const body = (req.body ?? {}) as {
    k?: number
    branches?: SelectedBranch[]
    source_analysis_id?: string | null
  }

  const k = Number(body.k)
  const branches = Array.isArray(body.branches) ? body.branches : []

  // ── Validation ─────────────────────────────────────────────────────────
  if (!Number.isInteger(k) || k < 1) {
    return res.status(400).json({ error: 'k must be a positive integer' })
  }
  if (branches.length !== k) {
    return res.status(400).json({
      error: `branches.length (${branches.length}) must equal k (${k})`,
    })
  }
  for (let i = 0; i < branches.length; i++) {
    const b = branches[i]
    if (!b || typeof b !== 'object') {
      return res.status(400).json({ error: `branches[${i}] is not an object` })
    }
    if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng)) {
      return res.status(400).json({
        error: `branches[${i}] (${b.name ?? 'unnamed'}) is missing valid lat/lng`,
      })
    }
    if (!b.name || typeof b.name !== 'string' || !b.name.trim()) {
      return res.status(400).json({
        error: `branches[${i}] is missing a name`,
      })
    }
    if (b.source !== 'existing' && b.source !== 'manual') {
      return res.status(400).json({
        error: `branches[${i}] has invalid source "${b.source}"`,
      })
    }
  }

  // Every existing_branch from constraints must appear in the selection. The
  // user can drop existing branches but only by removing them from the
  // Infrastructure tab first.
  const constraints = await loadConstraints(db, accountId)
  for (const eb of constraints.existing_branches) {
    const matchedIdx = branches.findIndex(
      (b) =>
        Math.abs(b.lat - eb.lat) < COORD_MATCH_TOLERANCE &&
        Math.abs(b.lng - eb.lng) < COORD_MATCH_TOLERANCE
    )
    if (matchedIdx < 0) {
      return res.status(400).json({
        error: `Existing branch "${eb.name}" must be included in the selection. Remove it from infrastructure first if you don't want it as a branch.`,
        existing_branch_name: eb.name,
      })
    }
    // Force source='existing' for matched rows so downstream UI labels them
    // correctly even if the client forgot.
    branches[matchedIdx] = { ...branches[matchedIdx], source: 'existing' }
  }

  // Round-trip the values to canonicalize.
  const cleanBranches: SelectedBranch[] = branches.map((b) => ({
    name: b.name.trim(),
    address: b.address?.trim() || null,
    city_state: (b.city_state ?? '').trim(),
    lat: Number(b.lat),
    lng: Number(b.lng),
    source: b.source,
    cluster_index:
      typeof b.cluster_index === 'number' && Number.isFinite(b.cluster_index)
        ? b.cluster_index
        : null,
  }))

  const sourceAnalysisId =
    typeof body.source_analysis_id === 'string' && body.source_analysis_id.trim()
      ? body.source_analysis_id.trim()
      : null

  const now = new Date().toISOString()
  const { error: upsertError } = await db
    .from('account_operational_constraints')
    .upsert(
      {
        account_id: accountId,
        selected_branches: cleanBranches,
        selected_k: k,
        selected_at: now,
        selected_from_analysis_id: sourceAnalysisId,
        selected_by: ctx.userId ?? null,
        updated_at: now,
        updated_by: ctx.userId ?? null,
      },
      { onConflict: 'account_id' }
    )

  if (upsertError) {
    return res.status(500).json({ error: upsertError.message })
  }

  const merged = await loadConstraints(db, accountId)
  return res.status(200).json({ ...merged, system_defaults: SYSTEM_DEFAULTS })
}

// Re-exported for typescript consumers.
export type { ExistingBranch }
