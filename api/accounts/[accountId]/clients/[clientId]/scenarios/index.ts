// /api/accounts/[accountId]/scenarios
//   GET  — list saved scenarios for the account, newest first
//   POST — save a new named scenario (body: name, description?, overrides,
//          module_results, synthesis_summary?)
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../../../_lib/supabase.js'
import { authenticateRequest } from '../../../../../_lib/auth.js'
import { loadConstraints } from '../../../../../_lib/analysis/operational-constraints.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  let ctx: Awaited<ReturnType<typeof authenticateRequest>>
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const accountId = req.query.accountId as string
  const clientId = req.query.clientId as string
  const db = createAdminClient()

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('analysis_scenarios')
      .select(
        'id, name, description, overrides, synthesis_summary, is_active, created_at, updated_at, created_by'
      )
      .eq('account_id', accountId)
      .eq('client_id', clientId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data ?? [])
  }

  if (req.method === 'POST') {
    const body = (req.body ?? {}) as {
      name?: string
      description?: string | null
      overrides?: Record<string, unknown>
      module_results?: Record<string, unknown>
      synthesis_summary?: string | null
    }

    if (!body.name?.trim()) {
      return res.status(400).json({ error: 'name is required' })
    }

    // Snapshot the constraints at save-time so we can reconstruct the scenario
    // later even if the user changes their constraints.
    const constraints = await loadConstraints(db, accountId, clientId)

    const { data, error } = await db
      .from('analysis_scenarios')
      .insert({
        account_id: accountId,
        client_id: clientId,
        name: body.name.trim(),
        description: body.description ?? null,
        constraints_snapshot: constraints,
        overrides: body.overrides ?? {},
        module_results: body.module_results ?? {},
        synthesis_summary: body.synthesis_summary ?? null,
        created_by: ctx.userId ?? null,
      })
      .select('*')
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(201).json(data)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
