// GET  /api/accounts/[accountId]/clients/[clientId]/constraint-templates
//      → list templates for this tenant
// POST /api/accounts/[accountId]/clients/[clientId]/constraint-templates
//      body: { name, description?, constraints: ConstraintInput[] }
//      → create. Each constraint in the array is validated; one bad
//      constraint rejects the whole template.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../../../_lib/supabase.js'
import { authenticateRequest, type AuthContext } from '../../../../../_lib/auth.js'
import {
  validateConstraint,
  type ConstraintInput,
} from '../../../../../_lib/analysis/constraint-validators.js'

export const config = { maxDuration: 10 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  let ctx: AuthContext
  try {
    ctx = await authenticateRequest(req)
  } catch (err) {
    const e = err as { statusCode?: number; message?: string }
    return res.status(e.statusCode ?? 401).json({ error: e.message ?? 'Unauthorized' })
  }

  const accountId = req.query.accountId as string
  const clientId = req.query.clientId as string
  if (!accountId || !clientId) {
    return res.status(400).json({ error: 'accountId and clientId required' })
  }

  const db = createAdminClient()

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('service_location_constraint_templates')
      .select('*')
      .eq('account_id', accountId)
      .eq('client_id', clientId)
      .order('name', { ascending: true })

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ templates: data ?? [] })
  }

  if (req.method === 'POST') {
    const body = (req.body ?? {}) as Record<string, unknown>
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return res.status(400).json({ error: 'name is required' })

    const constraints = Array.isArray(body.constraints) ? body.constraints : []
    const validated = validateConstraintList(constraints as ConstraintInput[])
    if (!validated.ok) {
      return res.status(400).json({ error: 'Invalid constraints in template', details: validated.errors })
    }

    const { data, error } = await db
      .from('service_location_constraint_templates')
      .insert({
        account_id: accountId,
        client_id: clientId,
        name,
        description: typeof body.description === 'string' ? body.description.trim() || null : null,
        constraints: validated.normalized,
        created_by: ctx.email ?? ctx.userId ?? null,
      })
      .select('*')
      .single()

    if (error) {
      // Unique-violation on (account_id, client_id, name)
      if (error.code === '23505') {
        return res.status(409).json({ error: 'A template with this name already exists' })
      }
      return res.status(500).json({ error: error.message })
    }
    return res.status(201).json({ template: data })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

interface ListValidationResult {
  ok: boolean
  errors: string[]
  normalized: Array<{ constraint_type: string; enforcement: string; config: Record<string, unknown>; notes?: string | null }>
}

export function validateConstraintList(list: ConstraintInput[]): ListValidationResult {
  if (list.length === 0) {
    return { ok: false, errors: ['Template must contain at least one constraint'], normalized: [] }
  }
  const errors: string[] = []
  const normalized: ListValidationResult['normalized'] = []
  for (let i = 0; i < list.length; i++) {
    const result = validateConstraint(list[i])
    if (!result.ok) {
      errors.push(`constraints[${i}]: ${result.errors.join('; ')}`)
      continue
    }
    normalized.push({
      constraint_type: result.normalized!.constraint_type,
      enforcement: result.normalized!.enforcement,
      config: result.normalized!.config,
      notes:
        typeof list[i].notes === 'string' && (list[i].notes as string).trim().length > 0
          ? (list[i].notes as string).trim()
          : null,
    })
  }
  return { ok: errors.length === 0, errors, normalized }
}
