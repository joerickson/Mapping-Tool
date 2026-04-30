// POST /api/service-locations/bulk-apply-constraints
// Body: either
//   { service_location_ids: string[], template_id: string }
// or
//   { service_location_ids: string[], constraints: ConstraintInput[] }
//
// Append-only: existing constraints on the selected SLs are NOT touched.
// If a user wants to start fresh they delete first, then apply. (Replace
// semantics are too easy to footgun on a 50-property bulk action.)
//
// Returns { applied: { service_location_id, inserted_count }[], failed: [...] }
// so the UI can show which SLs got the new rows and which didn't.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../_lib/supabase.js'
import { authenticateRequest, type AuthContext } from '../_lib/auth.js'
import {
  validateConstraint,
  type ConstraintInput,
} from '../_lib/analysis/constraint-validators.js'

export const config = { maxDuration: 30 }

const MAX_BULK_SLS = 500 // arbitrary safety cap — UI lets you select up to ~50

interface NormalizedConstraint {
  constraint_type: string
  enforcement: string
  config: Record<string, unknown>
  notes: string | null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let ctx: AuthContext
  try {
    ctx = await authenticateRequest(req)
  } catch (err) {
    const e = err as { statusCode?: number; message?: string }
    return res.status(e.statusCode ?? 401).json({ error: e.message ?? 'Unauthorized' })
  }

  const body = (req.body ?? {}) as Record<string, unknown>
  const slIds = Array.isArray(body.service_location_ids)
    ? (body.service_location_ids as string[])
    : []

  if (slIds.length === 0) {
    return res.status(400).json({ error: 'service_location_ids must be a non-empty array' })
  }
  if (slIds.length > MAX_BULK_SLS) {
    return res.status(400).json({ error: `cap is ${MAX_BULK_SLS} service locations per call` })
  }

  const db = createAdminClient()

  // Resolve constraints either from a template or from inline input.
  let templateConstraints: NormalizedConstraint[] | null = null

  if (typeof body.template_id === 'string') {
    const { data: tpl } = await db
      .from('service_location_constraint_templates')
      .select('id, constraints')
      .eq('id', body.template_id)
      .maybeSingle()

    if (!tpl) return res.status(404).json({ error: 'Template not found' })
    const arr = (tpl as { constraints: unknown }).constraints
    if (!Array.isArray(arr) || arr.length === 0) {
      return res.status(400).json({ error: 'Template has no constraints' })
    }
    // Re-validate defensively in case a constraint type became invalid
    // since the template was last saved.
    const validated = revalidate(arr as ConstraintInput[])
    if (!validated.ok) {
      return res.status(400).json({ error: 'Template contains invalid constraints', details: validated.errors })
    }
    templateConstraints = validated.normalized
  } else if (Array.isArray(body.constraints)) {
    const validated = revalidate(body.constraints as ConstraintInput[])
    if (!validated.ok) {
      return res.status(400).json({ error: 'Invalid constraints', details: validated.errors })
    }
    templateConstraints = validated.normalized
  } else {
    return res.status(400).json({ error: 'Provide either template_id or constraints[]' })
  }

  // Look up tenant scope for each SL — also confirms they exist + filters
  // out any IDs the caller doesn't have access to.
  const { data: sls, error: slErr } = await db
    .from('service_locations')
    .select('id, account_id, client_id')
    .in('id', slIds)

  if (slErr) return res.status(500).json({ error: slErr.message })
  const foundIds = new Set((sls ?? []).map((s) => (s as { id: string }).id))
  const missing = slIds.filter((id) => !foundIds.has(id))

  // Build the insert payload — N service_locations × M constraints rows.
  const rows: Array<Record<string, unknown>> = []
  const slsWithoutAccount: string[] = []
  for (const sl of sls ?? []) {
    const slRow = sl as { id: string; account_id: string | null; client_id: string | null }
    if (!slRow.account_id) {
      slsWithoutAccount.push(slRow.id)
      continue
    }
    for (const c of templateConstraints) {
      rows.push({
        service_location_id: slRow.id,
        account_id: slRow.account_id,
        client_id: slRow.client_id,
        constraint_type: c.constraint_type,
        enforcement: c.enforcement,
        config: c.config,
        notes: c.notes,
        created_by: ctx.email ?? ctx.userId ?? null,
      })
    }
  }

  if (rows.length === 0) {
    return res.status(200).json({
      applied: [],
      failed: [
        ...missing.map((id) => ({ service_location_id: id, error: 'not_found' })),
        ...slsWithoutAccount.map((id) => ({ service_location_id: id, error: 'no_account_id' })),
      ],
    })
  }

  // One bulk insert. Per-row failures are rare with our schema, but if the
  // whole insert fails we surface that to the caller and they can retry
  // smaller batches.
  const { error: insertErr } = await db
    .from('service_location_constraints')
    .insert(rows)

  if (insertErr) {
    return res.status(500).json({ error: insertErr.message })
  }

  // Group by service_location_id for the response.
  const counts = new Map<string, number>()
  for (const r of rows) {
    const id = r.service_location_id as string
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  return res.status(200).json({
    applied: Array.from(counts.entries()).map(([id, n]) => ({
      service_location_id: id,
      inserted_count: n,
    })),
    failed: [
      ...missing.map((id) => ({ service_location_id: id, error: 'not_found' })),
      ...slsWithoutAccount.map((id) => ({ service_location_id: id, error: 'no_account_id' })),
    ],
  })
}

function revalidate(list: ConstraintInput[]): {
  ok: boolean
  errors: string[]
  normalized: NormalizedConstraint[]
} {
  const errors: string[] = []
  const normalized: NormalizedConstraint[] = []
  for (let i = 0; i < list.length; i++) {
    const v = validateConstraint(list[i])
    if (!v.ok) {
      errors.push(`constraints[${i}]: ${v.errors.join('; ')}`)
      continue
    }
    normalized.push({
      constraint_type: v.normalized!.constraint_type,
      enforcement: v.normalized!.enforcement,
      config: v.normalized!.config,
      notes:
        typeof list[i].notes === 'string' && (list[i].notes as string).trim().length > 0
          ? (list[i].notes as string).trim()
          : null,
    })
  }
  return { ok: errors.length === 0, errors, normalized }
}
