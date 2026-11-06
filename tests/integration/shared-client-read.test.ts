/**
 * Integration test: PUBLIC GET /api/v1/shared-clients/[token] (no auth).
 *
 * Requires: TEST_BASE_URL, SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, and the
 * clients.share_token / share_expires_at migration applied to the live DB.
 *
 * Run: npx tsx tests/integration/shared-client-read.test.ts
 *
 * STATUS: WRITTEN-NOT-RUN (needs migration applied + running server).
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3000'
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

async function run() {
  const accountId = randomUUID()
  const memberAId = randomUUID()
  const memberBId = randomUUID()
  const combinedId = randomUUID()
  const emptyId = randomUUID()
  const expiredId = randomUUID()
  const propAId = randomUUID()
  const propBId = randomUUID()
  const tok = `t_${randomUUID()}`
  const tokEmpty = `t_${randomUUID()}`
  const tokExpired = `t_${randomUUID()}`

  try {
    await db.from('accounts').insert({ id: accountId, name: `shared-read-${accountId.slice(0, 8)}`, account_type: 'property_manager', status: 'active' }).throwOnError()

    for (const [cid, pid, lat] of [[memberAId, propAId, 33.4], [memberBId, propBId, 36.1]] as const) {
      await db.from('clients').insert({ id: cid, account_id: accountId, name: `member-${cid.slice(0, 8)}`, status: 'active' }).throwOnError()
      await db.from('properties').insert({ id: pid, client_id: cid, address_line1: '1 Test St', city: 'Phoenix', state: 'AZ', postal_code: '85001', country: 'US', latitude: lat, longitude: -112.0 }).throwOnError()
      await db.from('service_locations').insert({ id: randomUUID(), property_id: pid, client_id: cid, account_id: accountId, status: 'active' }).throwOnError()
    }
    await db.from('clients').insert({ id: combinedId, account_id: accountId, name: `combined-${combinedId.slice(0, 8)}`, status: 'active', is_combined: true, member_client_ids: [memberAId, memberBId], share_token: tok }).throwOnError()
    await db.from('clients').insert({ id: emptyId, account_id: accountId, name: `empty-${emptyId.slice(0, 8)}`, status: 'active', share_token: tokEmpty }).throwOnError()
    await db.from('clients').insert({ id: expiredId, account_id: accountId, name: `expired-${expiredId.slice(0, 8)}`, status: 'active', share_token: tokExpired, share_expires_at: new Date(Date.now() - 86400000).toISOString() }).throwOnError()

    await db.from('account_operational_constraints').insert({
      account_id: accountId,
      client_id: combinedId,
      selected_branches: [{ name: 'Branch One', city_state: 'Phoenix, AZ', lat: 33.45, lng: -112.07 }],
    }).throwOnError()

    // 1. Happy path (no auth header).
    const res = await fetch(`${BASE_URL}/api/v1/shared-clients/${tok}`)
    assert(res.status === 200, `happy path HTTP ${res.status}`)
    const text = await res.text()
    const body = JSON.parse(text)
    const ids = new Set((body.points ?? []).map((p: any) => p.id))
    assert(ids.has(propAId) && ids.has(propBId), 'points missing a member property')
    assert(body.branches.length === 1, 'expected exactly one branch')
    const b = body.branches[0]
    assert(b.name === 'Branch One' && b.lat === 33.45 && b.lng === -112.07, 'branch shape mismatch')
    assert(Object.keys(b).sort().join(',') === 'lat,lng,name', 'branch has extra keys')
    assert(!/cost|price|mcv|contract|revenue|financial|risk/i.test(text), 'payload leaks financial-looking keys')

    // 2. Unknown token -> 404.
    const r404 = await fetch(`${BASE_URL}/api/v1/shared-clients/t_${randomUUID()}`)
    assert(r404.status === 404, `unknown token expected 404, got ${r404.status}`)

    // 3. Expired -> 410.
    const r410 = await fetch(`${BASE_URL}/api/v1/shared-clients/${tokExpired}`)
    assert(r410.status === 410, `expired expected 410, got ${r410.status}`)

    // 4. No selected_branches -> 200 + [].
    const rEmpty = await fetch(`${BASE_URL}/api/v1/shared-clients/${tokEmpty}`)
    assert(rEmpty.status === 200, `no-branches expected 200, got ${rEmpty.status}`)
    const emptyBody = await rEmpty.json()
    assert(Array.isArray(emptyBody.branches) && emptyBody.branches.length === 0, 'branches should be []')

    console.log('PASS: shared-client-read')
  } finally {
    await db.from('account_operational_constraints').delete().eq('account_id', accountId)
    await db.from('service_locations').delete().eq('account_id', accountId)
    await db.from('properties').delete().in('id', [propAId, propBId])
    await db.from('clients').delete().eq('account_id', accountId)
    await db.from('accounts').delete().eq('id', accountId)
  }
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
