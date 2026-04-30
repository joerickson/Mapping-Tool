// PUT    /api/accounts/[accountId]/clients/[clientId]/constraint-templates/[templateId]
//        body: { name?, description?, constraints? } (partial update)
// DELETE same path

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../../../_lib/supabase.js'
import { authenticateRequest } from '../../../../../_lib/auth.js'
import { type ConstraintInput } from '../../../../../_lib/analysis/constraint-validators.js'
import { validateConstraintList } from './index.js'

export const config = { maxDuration: 10 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await authenticateRequest(req)
  } catch (err) {
    const e = err as { statusCode?: number; message?: string }
    return res.status(e.statusCode ?? 401).json({ error: e.message ?? 'Unauthorized' })
  }

  const accountId = req.query.accountId as string
  const clientId = req.query.clientId as string
  const templateId = req.query.templateId as string
  if (!accountId || !clientId || !templateId) {
    return res.status(400).json({ error: 'accountId, clientId, templateId required' })
  }

  const db = createAdminClient()

  // Tenant scoping — verify the template belongs to this (account, client)
  // before mutating. Prevents a caller from PUT'ing a template in someone
  // else's tenant just by guessing the templateId.
  const { data: existing } = await db
    .from('service_location_constraint_templates')
    .select('id, account_id, client_id')
    .eq('id', templateId)
    .maybeSingle()

  if (
    !existing ||
    (existing as { account_id: string }).account_id !== accountId ||
    (existing as { client_id: string }).client_id !== clientId
  ) {
    return res.status(404).json({ error: 'Template not found' })
  }

  if (req.method === 'PUT') {
    const body = (req.body ?? {}) as Record<string, unknown>
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (typeof body.name === 'string') {
      const trimmed = body.name.trim()
      if (!trimmed) return res.status(400).json({ error: 'name cannot be empty' })
      update.name = trimmed
    }
    if (body.description !== undefined) {
      update.description =
        typeof body.description === 'string' && body.description.trim().length > 0
          ? body.description.trim()
          : null
    }
    if (body.constraints !== undefined) {
      if (!Array.isArray(body.constraints)) {
        return res.status(400).json({ error: 'constraints must be an array' })
      }
      const validated = validateConstraintList(body.constraints as ConstraintInput[])
      if (!validated.ok) {
        return res.status(400).json({ error: 'Invalid constraints', details: validated.errors })
      }
      update.constraints = validated.normalized
    }

    const { data, error } = await db
      .from('service_location_constraint_templates')
      .update(update)
      .eq('id', templateId)
      .select('*')
      .single()

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'A template with this name already exists' })
      }
      return res.status(500).json({ error: error.message })
    }
    return res.status(200).json({ template: data })
  }

  if (req.method === 'DELETE') {
    const { error } = await db
      .from('service_location_constraint_templates')
      .delete()
      .eq('id', templateId)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(204).end()
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
