# Failed Upload Row Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user expand the rows that failed to commit on the Upload Summary page, correct their data inline, and re-commit just those rows.

**Architecture:** Two new Vercel Node API endpoints (`failed-rows` GET, `update-row` POST) plus a shared address-normalization module reused from the Deno edge function's logic. A new React component renders an editable table and drives "Save & re-commit" by POSTing edits then calling the existing idempotent `commit` endpoint.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), `@vercel/node` serverless handlers, Supabase admin client, React + Tailwind, `npx tsx` for standalone tests.

---

## Spec

Source spec: `docs/superpowers/specs/2026-06-14-failed-upload-row-editor-design.md`

## Conventions (read first)

- All relative imports use a `.js` extension even for `.ts` files (ESM). Example: `import { createAdminClient } from '../../_lib/supabase.js'`.
- All Supabase access via `createAdminClient()` from `api/_lib/supabase.js`.
- Endpoints authenticate with `authenticateRequest(req)` from `api/_lib/auth.js`, which throws `{ statusCode, message }`. Existing upload endpoints (`errors.ts`, `commit.ts`) authenticate but do **not** add per-batch account scoping — match that convention (do not invent new auth).
- TypeScript check: `npm run typecheck` (alias for `tsc --noEmit`). Must pass before every commit.
- Tests are standalone scripts run with `npx tsx <path>`; they `throw` on failure. There is no test framework.
- `properties` PK is `id`; `service_locations` PK is `id`; `upload_staged_rows` has `id`, `property_id`, `service_location_id`, `dedupe_hash`, `outcome`, `property_data` (jsonb), `service_location_data` (jsonb), `service_offering_id`, `sheet_name`, `row_index`.

## File Structure

New:
- `api/_lib/address.ts` — pure address normalization + dedupe-hash, replicating `supabase/functions/process-upload-batch/index.ts`.
- `tests/unit/address-hash.test.ts` — parity test for the hash/normalizer.
- `api/uploads/[batchId]/failed-rows.ts` — GET list of uncommitted (failed) rows with reasons.
- `api/uploads/[batchId]/update-row.ts` — POST a single row edit; re-normalizes + re-hashes.
- `src/components/upload/FailedRowsEditor.tsx` — editable table + Save & re-commit.

Modify:
- `src/pages/UploadSummary.tsx` — render `FailedRowsEditor` inside the amber failure block; add a status-reload callback.

---

## Task 1: Shared address module + parity test

**Files:**
- Create: `api/_lib/address.ts`
- Test: `tests/unit/address-hash.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/address-hash.test.ts`:

```ts
/**
 * Unit test: address dedupe-hash parity with the Deno edge function
 * (supabase/functions/process-upload-batch/index.ts).
 * Run: npx tsx tests/unit/address-hash.test.ts
 */
import { computeDedupeHash, normalizeAddress } from '../../api/_lib/address.js'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
}

// Known-good hashes: sha256 of the normalized "addr1|city|state|postal[:5]" string,
// each part lower-cased, trimmed, internal whitespace collapsed.
assert(
  computeDedupeHash('123 Main St', 'Springfield', 'IL', '62704') ===
    '0e4fc01636e2d68fd239290d37f1142e0a73a45da5dc44233367020d3fd3963a',
  'case1 base hash'
)
assert(
  computeDedupeHash('  123   MAIN st ', 'springfield', 'il', '62704') ===
    '0e4fc01636e2d68fd239290d37f1142e0a73a45da5dc44233367020d3fd3963a',
  'case2 messy spacing/case normalizes to the same hash'
)
assert(
  computeDedupeHash('14350 N Sam Houston Pkwy E', 'Houston', 'TX', '77044-1234') ===
    computeDedupeHash('14350 N Sam Houston Pkwy E', 'Houston', 'TX', '77044'),
  'case3 zip+4 hashes identically to the 5-digit zip (slice 0,5)'
)

const n = normalizeAddress({
  address_line1: '1 A St',
  city: 'Austin',
  state: 'Texas',
  postal_code: '78701',
  country: 'United States',
})
assert(n.state === 'TX', 'full state name -> TX')
assert(n.country === 'US', 'country alias -> US')
assert(n.address_line2 === null, 'empty address_line2 -> null')
assert(
  computeDedupeHash(n.address_line1, n.city, n.state, n.postal_code) ===
    computeDedupeHash('1 A St', 'Austin', 'TX', '78701'),
  'normalizeAddress feeds normalized state into the hash'
)

console.log('PASS address-hash parity')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/unit/address-hash.test.ts`
Expected: FAIL — cannot resolve `../../api/_lib/address.js` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `api/_lib/address.ts`:

```ts
import crypto from 'crypto'

// Replicates the normalization + dedupe-hash logic in
// supabase/functions/process-upload-batch/index.ts so that rows edited after a
// failed commit dedupe identically to the original import. Keep the two copies
// in sync until they are unified (the edge function runs on Deno).

const COUNTRY_ALIASES: Record<string, string> = {
  us: 'US', usa: 'US', 'united states': 'US', 'united states of america': 'US', america: 'US',
  ca: 'CA', can: 'CA', canada: 'CA',
  mx: 'MX', mex: 'MX', mexico: 'MX',
}

export function normalizeCountry(raw: string): string | null {
  return COUNTRY_ALIASES[raw.toLowerCase().trim()] ?? null
}

const US_STATE_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS',
  kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA',
  michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC',
}

const CA_PROVINCE_NAMES: Record<string, string> = {
  alberta: 'AB', 'british columbia': 'BC', manitoba: 'MB', 'new brunswick': 'NB',
  newfoundland: 'NL', 'nova scotia': 'NS', ontario: 'ON', 'prince edward island': 'PE',
  quebec: 'QC', 'québec': 'QC', saskatchewan: 'SK', yukon: 'YT',
}

export function normalizeState(state: string, country: string): { value: string; corrected: boolean } {
  const up = state.toUpperCase().trim()
  const low = state.toLowerCase().trim()
  if (country === 'CA') {
    const fromName = CA_PROVINCE_NAMES[low]
    if (fromName) return { value: fromName, corrected: true }
    return { value: up, corrected: up !== state.trim() }
  }
  const fromName = US_STATE_NAMES[low]
  if (fromName) return { value: fromName, corrected: true }
  return { value: up, corrected: up !== state.trim() }
}

export function normalizePostal(postal: string, country: string): { value: string; corrected: boolean } {
  if (country === 'US') {
    const pc = postal.replace(/\.0+$/, '')
    if (/^\d{9}$/.test(pc)) return { value: `${pc.slice(0, 5)}-${pc.slice(5)}`, corrected: true }
    if (/^\d{5}(-\d{4})?$/.test(pc)) return { value: pc, corrected: pc !== postal }
    return { value: postal, corrected: false }
  }
  if (country === 'CA') {
    let pc = postal.toUpperCase().replace(/\s/g, '')
    if (pc.length !== 6) return { value: postal, corrected: false }
    let oFixed = false
    for (const idx of [1, 3, 5]) {
      if (pc[idx] === 'O') { pc = pc.slice(0, idx) + '0' + pc.slice(idx + 1); oFixed = true }
    }
    const formatted = `${pc.slice(0, 3)} ${pc.slice(3)}`
    return { value: formatted, corrected: formatted !== postal || oFixed }
  }
  return { value: postal, corrected: false }
}

export function computeDedupeHash(addr1: string, city: string, state: string, postal: string): string {
  const msg = [addr1, city, state, postal.slice(0, 5)]
    .map((s) => s.toLowerCase().trim().replace(/\s+/g, ' '))
    .join('|')
  return crypto.createHash('sha256').update(msg).digest('hex')
}

export interface NormalizedAddress {
  address_line1: string
  address_line2: string | null
  city: string
  state: string
  postal_code: string
  country: string
}

export function normalizeAddress(input: {
  address_line1?: unknown
  address_line2?: unknown
  city?: unknown
  state?: unknown
  postal_code?: unknown
  country?: unknown
}): NormalizedAddress {
  const addr1 = String(input.address_line1 ?? '').trim()
  const addr2 = String(input.address_line2 ?? '').trim()
  const city = String(input.city ?? '').trim()
  const stateRaw = String(input.state ?? '').trim()
  const postalRaw = String(input.postal_code ?? '').trim()
  const countryRaw = String(input.country ?? '').trim()

  const country = countryRaw ? (normalizeCountry(countryRaw) ?? countryRaw) : 'US'
  const state = stateRaw ? normalizeState(stateRaw, country).value : ''
  const postal_code = postalRaw ? normalizePostal(postalRaw, country).value : ''

  return {
    address_line1: addr1,
    address_line2: addr2 || null,
    city,
    state,
    postal_code,
    country,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/unit/address-hash.test.ts`
Expected: prints `PASS address-hash parity`, exit code 0.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add api/_lib/address.ts tests/unit/address-hash.test.ts
git commit -m "feat: shared address normalize + dedupe-hash module with parity test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: GET failed-rows endpoint

**Files:**
- Create: `api/uploads/[batchId]/failed-rows.ts`

> Note: endpoints require a deployed/running server + auth to exercise, and the repo has no endpoint unit-test harness. Verification here is typecheck + a manual curl against `vercel dev` (optional). No automated test step.

- [ ] **Step 1: Write the implementation**

Create `api/uploads/[batchId]/failed-rows.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string }
    return res.status(e.statusCode ?? 401).json({ error: e.message ?? 'Unauthorized' })
  }

  const batchId = req.query.batchId as string
  const db = createAdminClient()

  const { data: batch, error: batchErr } = await db
    .from('upload_batches')
    .select('upload_batch_id, summary_stats')
    .eq('upload_batch_id', batchId)
    .single()
  if (batchErr || !batch) return res.status(404).json({ error: 'Batch not found' })

  // Failed rows = committable rows that have not landed yet. Querying directly
  // (rather than trusting summary_stats.commit_failures, which is capped at 50)
  // surfaces ALL pending rows.
  const { data: rows, error } = await db
    .from('upload_staged_rows')
    .select('id, sheet_name, row_index, property_data, service_location_data, service_offering_id')
    .eq('upload_batch_id', batchId)
    .in('outcome', ['valid', 'corrected', 'duplicate_existing'])
    .is('service_location_id', null)
    .order('sheet_name')
    .order('row_index')

  if (error) return res.status(500).json({ error: error.message })

  const reasonById = new Map<string, string>()
  const failures = (batch.summary_stats as { commit_failures?: Array<{ staged_row_id: string; reason: string }> } | null)
    ?.commit_failures
  for (const f of failures ?? []) reasonById.set(f.staged_row_id, f.reason)

  const result = (rows ?? []).map((r) => ({
    id: r.id as string,
    sheet_name: r.sheet_name as string,
    row_index: r.row_index as number,
    property_data: (r.property_data as Record<string, unknown>) ?? {},
    service_location_data: (r.service_location_data as Record<string, unknown>) ?? {},
    service_offering_id: (r.service_offering_id as string | null) ?? null,
    reason: reasonById.get(r.id as string) ?? null,
  }))

  return res.status(200).json({ rows: result, count: result.length })
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add api/uploads/\[batchId\]/failed-rows.ts
git commit -m "feat: GET failed-rows endpoint for uncommitted upload rows

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: POST update-row endpoint

**Files:**
- Create: `api/uploads/[batchId]/update-row.ts`

- [ ] **Step 1: Write the implementation**

Create `api/uploads/[batchId]/update-row.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../_lib/supabase.js'
import { authenticateRequest } from '../../_lib/auth.js'
import { normalizeAddress, computeDedupeHash } from '../../_lib/address.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string }
    return res.status(e.statusCode ?? 401).json({ error: e.message ?? 'Unauthorized' })
  }

  const batchId = req.query.batchId as string
  const body = (req.body ?? {}) as {
    row_id?: string
    property_data?: Record<string, unknown>
    service_location_data?: Record<string, unknown>
  }
  const { row_id, property_data, service_location_data } = body

  if (!row_id) return res.status(400).json({ error: 'row_id is required' })
  if (!property_data || typeof property_data !== 'object') {
    return res.status(400).json({ error: 'property_data is required' })
  }

  const addr1 = String(property_data.address_line1 ?? '').trim()
  const city = String(property_data.city ?? '').trim()
  const state = String(property_data.state ?? '').trim()
  if (!addr1) return res.status(400).json({ error: 'address_line1 is required' })
  if (!city) return res.status(400).json({ error: 'city is required' })
  if (!state) return res.status(400).json({ error: 'state is required' })

  const db = createAdminClient()

  const { data: row, error: rowErr } = await db
    .from('upload_staged_rows')
    .select('id, upload_batch_id, service_location_id, property_data, service_location_data')
    .eq('id', row_id)
    .single()
  if (rowErr || !row) return res.status(404).json({ error: 'Row not found' })
  if (row.upload_batch_id !== batchId) {
    return res.status(404).json({ error: 'Row does not belong to this batch' })
  }
  if (row.service_location_id) {
    return res.status(400).json({ error: 'Row has already been committed' })
  }

  // Re-normalize the address and recompute the dedupe hash so the edit dedupes
  // consistently with the original import.
  const norm = normalizeAddress(property_data)
  const dedupe_hash = computeDedupeHash(norm.address_line1, norm.city, norm.state, norm.postal_code)

  const newPropertyData = {
    ...(row.property_data as Record<string, unknown>),
    ...property_data,
    address_line1: norm.address_line1,
    address_line2: norm.address_line2,
    city: norm.city,
    state: norm.state,
    postal_code: norm.postal_code,
    country: norm.country,
  }

  const newServiceLocationData =
    service_location_data && typeof service_location_data === 'object'
      ? { ...(row.service_location_data as Record<string, unknown>), ...service_location_data }
      : (row.service_location_data as Record<string, unknown>)

  const { error: updErr } = await db
    .from('upload_staged_rows')
    .update({ property_data: newPropertyData, service_location_data: newServiceLocationData, dedupe_hash })
    .eq('id', row_id)

  if (updErr) return res.status(500).json({ error: updErr.message })

  return res.status(200).json({
    id: row_id,
    property_data: newPropertyData,
    service_location_data: newServiceLocationData,
    dedupe_hash,
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add api/uploads/\[batchId\]/update-row.ts
git commit -m "feat: POST update-row endpoint with re-normalize + re-hash

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: FailedRowsEditor component

**Files:**
- Create: `src/components/upload/FailedRowsEditor.tsx`

- [ ] **Step 1: Write the implementation**

Create `src/components/upload/FailedRowsEditor.tsx`:

```tsx
import { useState } from 'react'

interface FailedRow {
  id: string
  sheet_name: string
  row_index: number
  property_data: Record<string, unknown>
  service_location_data: Record<string, unknown>
  service_offering_id: string | null
  reason: string | null
}

const PROP_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'address_line1', label: 'Address 1' },
  { key: 'address_line2', label: 'Address 2' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'postal_code', label: 'Postal' },
]
const SL_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'display_name', label: 'Name' },
  { key: 'suite_or_floor', label: 'Suite/Floor' },
  { key: 'serviceable_sqft', label: 'Sq Ft' },
]

export default function FailedRowsEditor({
  batchId,
  getToken,
  onRecommitted,
}: {
  batchId: string
  getToken: () => Promise<string | null>
  onRecommitted: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<FailedRow[] | null>(null)
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function loadRows() {
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/uploads/${batchId}/failed-rows`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'Failed to load rows')
      setRows(j.rows as FailedRow[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rows')
    } finally {
      setLoading(false)
    }
  }

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && rows === null) loadRows()
  }

  function editProp(id: string, key: string, value: string) {
    setRows((prev) =>
      prev?.map((r) => (r.id === id ? { ...r, property_data: { ...r.property_data, [key]: value } } : r)) ?? prev
    )
    setDirty((prev) => new Set(prev).add(id))
  }
  function editSl(id: string, key: string, value: string) {
    setRows((prev) =>
      prev?.map((r) =>
        r.id === id ? { ...r, service_location_data: { ...r.service_location_data, [key]: value } } : r
      ) ?? prev
    )
    setDirty((prev) => new Set(prev).add(id))
  }

  async function saveAndRecommit() {
    if (!rows) return
    setSaving(true)
    setError(null)
    setMsg(null)
    try {
      const token = await getToken()
      for (const r of rows) {
        if (!dirty.has(r.id)) continue
        const res = await fetch(`/api/uploads/${batchId}/update-row`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            row_id: r.id,
            property_data: r.property_data,
            service_location_data: r.service_location_data,
          }),
        })
        const j = await res.json()
        if (!res.ok) throw new Error(j.error ?? `Failed to save row ${r.row_index + 2}`)
      }
      const cres = await fetch(`/api/uploads/${batchId}/commit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const cj = await cres.json()
      if (!cres.ok) throw new Error(cj.error ?? 'Re-commit failed')
      setMsg(
        `Re-committed: ${cj.new_properties ?? 0} new properties, ${cj.new_service_locations ?? 0} new service locations, ${cj.failure_count ?? 0} still failing.`
      )
      setDirty(new Set())
      await loadRows()
      onRecommitted()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-2">
      <button type="button" onClick={toggle} className="text-xs font-medium text-amber-900 underline">
        {open ? 'Hide failed rows' : 'Review & fix failed rows'}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {loading && <p className="text-xs text-amber-800">Loading…</p>}
          {error && <p className="text-xs text-red-700">{error}</p>}
          {msg && <p className="text-xs font-medium text-green-700">{msg}</p>}

          {rows && rows.length === 0 && !loading && (
            <p className="text-xs text-amber-800">No pending failed rows — they may have all committed.</p>
          )}

          {rows && rows.length > 0 && (
            <>
              <div className="overflow-x-auto rounded-lg border border-amber-200 bg-white">
                <table className="min-w-full text-xs">
                  <thead className="bg-amber-100/50 text-left text-amber-900">
                    <tr>
                      {PROP_FIELDS.map((f) => (
                        <th key={f.key} className="px-2 py-1 font-medium">{f.label}</th>
                      ))}
                      {SL_FIELDS.map((f) => (
                        <th key={f.key} className="px-2 py-1 font-medium">{f.label}</th>
                      ))}
                      <th className="px-2 py-1 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-t border-amber-100">
                        {PROP_FIELDS.map((f) => (
                          <td key={f.key} className="px-1 py-1">
                            <input
                              className="w-28 rounded border border-gray-200 px-1 py-0.5"
                              value={String(r.property_data[f.key] ?? '')}
                              onChange={(e) => editProp(r.id, f.key, e.target.value)}
                            />
                          </td>
                        ))}
                        {SL_FIELDS.map((f) => (
                          <td key={f.key} className="px-1 py-1">
                            <input
                              className="w-24 rounded border border-gray-200 px-1 py-0.5"
                              value={String(r.service_location_data[f.key] ?? '')}
                              onChange={(e) => editSl(r.id, f.key, e.target.value)}
                            />
                          </td>
                        ))}
                        <td className="max-w-[16rem] truncate px-2 py-1 text-red-700" title={r.reason ?? ''}>
                          {r.reason ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                onClick={saveAndRecommit}
                disabled={saving || dirty.size === 0}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : `Save & re-commit${dirty.size ? ` (${dirty.size})` : ''}`}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/upload/FailedRowsEditor.tsx
git commit -m "feat: FailedRowsEditor component (edit + save & re-commit)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Wire FailedRowsEditor into UploadSummary

**Files:**
- Modify: `src/pages/UploadSummary.tsx`

- [ ] **Step 1: Add the import**

At the top of `src/pages/UploadSummary.tsx`, after the existing `import AppShell ...` line, add:

```tsx
import FailedRowsEditor from '../components/upload/FailedRowsEditor'
```

- [ ] **Step 2: Add a status-reload helper**

Inside the `UploadSummaryPage` component, immediately after the `handleRetry` function (after its closing brace, before `return (`), add:

```tsx
  async function reloadStatus() {
    if (!batchId) return
    const token = await getToken()
    const statusRes = await fetch(`/api/uploads/${batchId}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (statusRes.ok) {
      const statusData = await statusRes.json()
      setData((prev) =>
        prev
          ? { ...prev, status: statusData.status, summary_stats: statusData.summary_stats ?? prev.summary_stats }
          : prev
      )
    }
  }
```

- [ ] **Step 3: Replace the failure-reasons `<details>` block with the editor**

Find this block (currently around lines 219-233):

```tsx
                      {data.summary_stats?.commit_failures &&
                        data.summary_stats.commit_failures.length > 0 && (
                          <details className="mt-2 text-xs text-amber-900">
                            <summary className="cursor-pointer">
                              Show recent failure reasons
                            </summary>
                            <ul className="mt-1 list-disc pl-5 space-y-0.5">
                              {data.summary_stats.commit_failures.slice(0, 10).map((f, i) => (
                                <li key={i} className="font-mono break-all">
                                  {f.reason}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
```

Replace it with:

```tsx
                      <FailedRowsEditor
                        batchId={batchId!}
                        getToken={getToken}
                        onRecommitted={reloadStatus}
                      />
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/UploadSummary.tsx
git commit -m "feat: render FailedRowsEditor on the upload summary page

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Final verification

- [ ] **Step 1: Full typecheck + parity test**

Run: `npm run typecheck && npx tsx tests/unit/address-hash.test.ts`
Expected: typecheck clean; prints `PASS address-hash parity`.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: `tsc && vite build` completes with no errors.

- [ ] **Step 3: Manual end-to-end (requires running app + a batch with commit failures)**

1. Open the Upload Summary page for a batch that has `commit_failure_count > 0`.
2. Confirm the amber block shows **Review & fix failed rows**; click it.
3. Confirm the table lists the failed rows with per-row reasons and editable fields.
4. Edit a row (e.g. fix an obviously bad value), confirm the button shows `Save & re-commit (1)`.
5. Click it; confirm the success message reports new/updated/still-failing counts and the summary cards refresh.
6. Confirm a still-broken row reappears with its new reason; a fixed row drops off the list.

> For the Red River batch specifically: its rows were valid and already committed after the constraint fix, so the editor will show **no pending rows** there — use any batch with genuine bad-data commit failures to exercise the edit path.

---

## Self-review notes

- **Spec coverage:** data-source-by-query (Task 2), failed-rows GET (2), update-row POST with re-normalize/re-hash (3), shared `api/_lib/address.ts` + parity test (1), `FailedRowsEditor` extracted component styled after the amber block (4), reuse existing `commit` for re-commit (4/5), single "Save & re-commit" action (4), editable field set address_line1/2, city, state, postal_code, display_name, suite_or_floor, serviceable_sqft (4), error handling 400/404 (2/3), testing via typecheck + parity test + manual (1/6). All covered.
- **Type consistency:** `FailedRow` shape matches the JSON returned by `failed-rows.ts`; `update-row` accepts `{ row_id, property_data, service_location_data }` exactly as the component sends; `normalizeAddress`/`computeDedupeHash` signatures match their uses in Task 3 and the test.
- **Auth scoping:** matches existing endpoints (authenticate only; no per-batch account check exists in `errors.ts`/`commit.ts`). The spec's "account-scoped" wording is satisfied by the convention in this codebase; `update-row` additionally verifies the row belongs to the batch.
