/**
 * Integration test: GET /api/v1/properties resolves a combined client to its
 * members.
 *
 * Regression guard for the "combined client → empty map" bug: a combined
 * client owns no service_locations of its own, so filtering /api/v1/properties
 * by the combined client's own id used to return zero properties (an empty
 * portfolio map / main map). The endpoint must expand a combined client into
 * its member client_ids (via resolveClientIdsList) and return the members'
 * properties.
 *
 * Requires:
 *   TEST_BASE_URL              — e.g. http://localhost:3000
 *   TEST_SERVICE_KEY           — a valid rbm_sk_* key (service-mode auth is
 *                                allowed on GET /api/v1/properties when a
 *                                client_id is supplied)
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — to seed/clean fixtures directly
 *
 * Run: npx tsx tests/integration/combined-client-properties.test.ts
 *
 * NOTE: WRITTEN-NOT-RUN in the authoring environment (no live server/DB). The
 * exact NOT NULL columns on properties/service_locations may need a tweak on
 * the first real run.
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3000'
const SERVICE_KEY = process.env.TEST_SERVICE_KEY ?? process.env.SERVICE_API_KEY ?? ''
const SUPABASE_URL = process.env.SUPABASE_URL ?? ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.log('SKIP: set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to run this test')
  process.exit(0)
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const headers = { 'Content-Type': 'application/json', 'X-RBM-Service-Key': SERVICE_KEY }

async function run() {
  const accountId = randomUUID()
  const memberAId = randomUUID()
  const memberBId = randomUUID()
  const combinedId = randomUUID()
  const propAId = randomUUID()
  const propBId = randomUUID()

  const made: Array<() => Promise<unknown>> = []
  try {
    await db.from('accounts').insert({ id: accountId, name: `combined-test-${accountId.slice(0, 8)}`, account_type: 'property_manager', status: 'active' }).throwOnError()
    made.unshift(() => db.from('accounts').delete().eq('id', accountId))

    for (const [cid, pid, lat] of [[memberAId, propAId, 33.4], [memberBId, propBId, 36.1]] as const) {
      await db.from('clients').insert({ id: cid, account_id: accountId, name: `member-${cid.slice(0, 8)}`, status: 'active' }).throwOnError()
      await db.from('properties').insert({ id: pid, client_id: cid, address_line1: '1 Test St', city: 'Phoenix', state: 'AZ', postal_code: '85001', country: 'US', latitude: lat, longitude: -112.0 }).throwOnError()
      await db.from('service_locations').insert({ id: randomUUID(), property_id: pid, client_id: cid, account_id: accountId, status: 'active' }).throwOnError()
    }
    // Combined client: owns no service_locations; references the two members.
    await db.from('clients').insert({ id: combinedId, account_id: accountId, name: `combined-${combinedId.slice(0, 8)}`, status: 'active', is_combined: true, member_client_ids: [memberAId, memberBId] }).throwOnError()
    made.unshift(() => db.from('service_locations').delete().in('client_id', [memberAId, memberBId]))
    made.unshift(() => db.from('properties').delete().in('client_id', [memberAId, memberBId]))
    made.unshift(() => db.from('clients').delete().in('id', [memberAId, memberBId, combinedId]))

    // 1. Combined client returns BOTH members' properties (the fix).
    const combinedRes = await fetch(`${BASE_URL}/api/v1/properties?client_id=${combinedId}&limit=2000`, { headers })
    assert(combinedRes.ok, `combined query HTTP ${combinedRes.status}`)
    const combinedBody = await combinedRes.json()
    const combinedIds = new Set((combinedBody.properties ?? []).map((p: any) => p.property_id ?? p.id))
    assert(combinedIds.has(propAId), 'combined result missing member A property')
    assert(combinedIds.has(propBId), 'combined result missing member B property')

    // 2. Regression: a normal client still returns only its own property.
    const normalRes = await fetch(`${BASE_URL}/api/v1/properties?client_id=${memberAId}&limit=2000`, { headers })
    assert(normalRes.ok, `normal query HTTP ${normalRes.status}`)
    const normalBody = await normalRes.json()
    const normalIds = new Set((normalBody.properties ?? []).map((p: any) => p.property_id ?? p.id))
    assert(normalIds.has(propAId), 'normal result missing own property')
    assert(!normalIds.has(propBId), 'normal result leaked another client property')

    console.log('PASS: combined client resolves to members; normal client unaffected')
  } finally {
    for (const undo of made) await undo().catch(() => {})
  }
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
