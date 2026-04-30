import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'
import { fireWebhook } from '../../_lib/webhooks.js'
import { validateAddress, geocodeAddress } from '../../_lib/google-address.js'
import { recordEdits } from '../../_lib/property-audit.js'
import {
  PROPERTY_FIELDS,
  ADDRESS_FIELD_KEYS,
  isEditablePropertyField,
} from '../../../src/lib/editable-fields.js'
import {
  determineCascadingEffects,
  applyCascadingEffects,
  type FieldChange,
} from '../../_lib/analysis/edit-cascade.js'

export const config = { maxDuration: 30 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  let ctx: Awaited<ReturnType<typeof authenticateRequest>>
  try {
    ctx = await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const { id } = req.query
  const propertyId = id as string
  const db = createAdminClient()

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('properties')
      .select('*, service_locations(*)')
      .eq('id', propertyId)
      .single()

    if (error || !data) {
      return res.status(404).json({ error: error?.message ?? 'Not found' })
    }

    const aliased = {
      ...data,
      property_id: (data as any).id,
      service_locations: ((data as any).service_locations ?? []).map((sl: any) => ({
        ...sl,
        service_location_id: sl.id,
      })),
    }
    return res.status(200).json(aliased)
  }

  if (req.method === 'PATCH') {
    const body = (req.body ?? {}) as Record<string, unknown>
    const editReason =
      typeof body.edit_reason === 'string' && body.edit_reason.trim().length > 0
        ? body.edit_reason.trim()
        : null

    // Whitelist — silently drop anything not in PROPERTY_FIELDS so callers
    // can't update system-managed columns (lat/lng, address_hash,
    // geocode_*, enrichment_*, validated_*) by stuffing them into PATCH.
    const updates: Record<string, unknown> = {}
    const rejected: string[] = []
    for (const [k, v] of Object.entries(body)) {
      if (k === 'edit_reason') continue
      if (isEditablePropertyField(k)) updates[k] = v
      else rejected.push(k)
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        error: 'No editable fields in body',
        editable: PROPERTY_FIELDS.map((f) => f.key),
        rejected,
      })
    }

    // Snapshot the current row so we can diff for audit + detect address change.
    const { data: current, error: fetchErr } = await db
      .from('properties')
      .select('*')
      .eq('id', propertyId)
      .single()

    if (fetchErr || !current) {
      return res.status(404).json({ error: fetchErr?.message ?? 'Not found' })
    }

    const { data: updated, error: updateErr } = await db
      .from('properties')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', propertyId)
      .select('*')
      .single()

    if (updateErr) return res.status(500).json({ error: updateErr.message })

    const accountId = (current as any).account_id ?? null
    const clientId = (current as any).client_id ?? null

    // Phase 4b — centralized cascade. Diff old vs new, ask edit-cascade
    // which downstream modules to stale, persist effects on the audit row.
    const fieldChanges: FieldChange[] = Object.keys(updates)
      .filter((k) => !deepEqual((current as any)[k], (updated as any)[k]))
      .map((k) => ({ field: k, old: (current as any)[k], new: (updated as any)[k] }))
    const effects = determineCascadingEffects('property', fieldChanges)

    const changed = await recordEdits(
      db,
      { propertyId, accountId, clientId },
      current as Record<string, unknown>,
      updated as Record<string, unknown>,
      Object.keys(updates),
      {
        changedBy: ctx.email ?? ctx.userId ?? null,
        reason: editReason,
        cascadingEffects: fieldChanges.length > 0 ? effects : null,
      }
    )

    let cascadeApplied: { staled: string[]; synthesis_triggered: boolean } = {
      staled: [],
      synthesis_triggered: false,
    }
    if (accountId && clientId && effects.analyses_to_stale.length > 0) {
      cascadeApplied = await applyCascadingEffects(db, effects, {
        account_id: accountId,
        client_id: clientId,
        property_id: propertyId,
      })
    }

    // Side effect: address change → re-validate + re-geocode + persist
    // lat/lng. Done synchronously so the user sees the corrected map pin
    // without a follow-up refresh.
    let geocodeResult: { lat: number | null; lng: number | null; verdict: string | null } | null = null
    const addressChanged = changed.some((k) => ADDRESS_FIELD_KEYS.includes(k))
    if (addressChanged) {
      try {
        const addr = {
          address_line1: String((updated as any).address_line1 ?? ''),
          address_line2: ((updated as any).address_line2 as string | null) ?? null,
          city: String((updated as any).city ?? ''),
          state: String((updated as any).state ?? ''),
          postal_code: String((updated as any).postal_code ?? ''),
          country: String((updated as any).country ?? 'US'),
        }
        const validation = await validateAddress(addr)
        const geo = await geocodeAddress(validation?.validated ?? addr)

        const patch: Record<string, unknown> = {}
        if (validation) {
          patch.address_validation_result = validation.raw_response
          patch.address_validation_verdict = validation.verdict
          patch.address_validated_at = new Date().toISOString()
          patch.validated_address_line1 = validation.validated.address_line1
          patch.validated_city = validation.validated.city
          patch.validated_state = validation.validated.state
          patch.validated_postal_code = validation.validated.postal_code
          patch.validated_country = validation.validated.country
        }
        if (geo) {
          patch.latitude = geo.latitude
          patch.longitude = geo.longitude
          patch.geocode_source = geo.source
          patch.geocode_confidence = geo.confidence
          patch.geocoded_at = new Date().toISOString()
          patch.google_place_id = geo.place_id
        }
        if (Object.keys(patch).length > 0) {
          await db.from('properties').update(patch).eq('id', propertyId)
        }
        geocodeResult = {
          lat: geo?.latitude ?? null,
          lng: geo?.longitude ?? null,
          verdict: validation?.verdict ?? null,
        }
      } catch (err) {
        console.error('re-geocode after address edit failed:', err)
      }
    }

    await fireWebhook('property.updated', {
      property_id: propertyId,
      changed_fields: changed,
      changed_by: ctx.userId ?? 'service',
    })

    // Return the freshest row including any geocode patch.
    const { data: finalRow } = await db
      .from('properties')
      .select('*')
      .eq('id', propertyId)
      .single()

    return res.status(200).json({
      property: finalRow,
      changed_fields: changed,
      rejected_fields: rejected,
      geocode: geocodeResult,
      cascading_effects: {
        analyses_marked_stale: cascadeApplied.staled,
        synthesis_refresh_triggered: cascadeApplied.synthesis_triggered,
        comparables_invalidated: effects.comparables_invalidate,
        reasons: effects.reasons,
      },
      edits_recorded: changed.length,
    })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return a == null && b == null
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
    return true
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a as object)
    const bk = Object.keys(b as object)
    if (ak.length !== bk.length) return false
    for (const k of ak) {
      if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
    }
    return true
  }
  return false
}
