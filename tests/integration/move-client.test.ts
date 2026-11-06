/**
 * Integration test: admin move-client-across-accounts endpoint
 *
 * Requires:
 *   TEST_ADMIN_TOKEN  — a real admin user bearer token (requireAdmin rejects service keys)
 *   TEST_BASE_URL     — e.g. http://localhost:3000
 *   SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY — for seeding
 *   TEST_MEMBER_TOKEN — optional non-admin user token (403 check)
 *
 * Run: npx tsx tests/integration/move-client.test.ts
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3000'
const ADMIN_TOKEN = process.env.TEST_ADMIN_TOKEN ?? ''
const MEMBER_TOKEN = process.env.TEST_MEMBER_TOKEN ?? ''
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const db: any = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`FAIL: ${msg}`)
}

async function must<T>(p: PromiseLike<{ data: T; error: any }>, what: string): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(`seed failed (${what}): ${error.message}`)
  return data
}

async function move(clientId: string, body: Record<string, unknown>, token: string | null = ADMIN_TOKEN) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE_URL}/api/v1/clients/${clientId}/move`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  let json: any = null
  try { json = await res.json() } catch { /* empty */ }
  return { status: res.status, json }
}

const suffix = randomUUID().slice(0, 8)
const createdAccounts: string[] = []
const createdClients: string[] = []

async function mkAccount(label: string): Promise<string> {
  const row: any = await must(
    db.from('accounts').insert({ name: `mvtest-${label}-${suffix}`, account_type: 'property_manager' }).select('id').single(),
    `account ${label}`,
  )
  createdAccounts.push(row.id)
  return row.id
}

async function mkClient(accountId: string, name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const row: any = await must(
    db.from('clients').insert({ account_id: accountId, name, status: 'active', ...extra }).select('id').single(),
    `client ${name}`,
  )
  createdClients.push(row.id)
  return row.id
}

async function cleanup() {
  for (const id of createdClients) {
    for (const t of ['service_locations', 'analysis_scenarios', 'upload_batches', 'service_offerings']) {
      await db.from(t).delete().eq('client_id', id)
    }
  }
  if (createdClients.length) await db.from('client_account_moves').delete().in('client_id', createdClients)
  if (createdClients.length) await db.from('clients').delete().in('id', createdClients)
  for (const id of createdAccounts) {
    await db.from('service_offerings').delete().eq('account_id', id)
    await db.from('accounts').delete().eq('id', id)
  }
}

async function run() {
  console.log('--- Move client integration test ---')
  assert(!!ADMIN_TOKEN, 'TEST_ADMIN_TOKEN is required')
  assert(!!SUPABASE_URL && !!SERVICE_ROLE, 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for seeding')

  const A = await mkAccount('A')
  const B = await mkAccount('B')
  const clientId = await mkClient(A, `Move Me ${suffix}`)

  // Seed children under A
  const sl: any = await must(
    db.from('service_locations').insert({ account_id: A, client_id: clientId, name: 'SL1' }).select('id').single(),
    'service_location',
  )
  const sc: any = await must(
    db.from('analysis_scenarios').insert({ account_id: A, client_id: clientId, name: 'Scen1' }).select('id').single(),
    'analysis_scenario',
  )
  const ub: any = await must(
    db.from('upload_batches').insert({ account_id: A, client_id: clientId }).select('id').single(),
    'upload_batch',
  )
  const offering: any = await must(
    db.from('service_offerings').insert({ account_id: A, client_id: null, name: `Offering ${suffix}` }).select('id').single(),
    'account-wide service_offering',
  )
  console.log('✓ seeded')

  // Auth
  const noAuth = await move(clientId, { target_account_id: B }, null)
  assert(noAuth.status === 401, `no token should be 401, got ${noAuth.status}`)
  if (MEMBER_TOKEN) {
    const m = await move(clientId, { target_account_id: B }, MEMBER_TOKEN)
    assert(m.status === 403, `non-admin should be 403, got ${m.status}`)
  }
  console.log('✓ auth gates')

  // Happy path
  const r1 = await move(clientId, { target_account_id: B })
  assert(r1.status === 200, `move should be 200, got ${r1.status} ${JSON.stringify(r1.json)}`)
  assert(r1.json.moved === true, 'moved should be true')
  assert(r1.json.to_account_id === B, 'to_account_id should be B')
  assert(r1.json.from_account_id === A, 'from_account_id should be A')
  assert(r1.json.stragglers === 0, `stragglers should be 0, got ${r1.json.stragglers}`)

  const cRow: any = await must(db.from('clients').select('account_id').eq('id', clientId).single(), 'reread client')
  assert(cRow.account_id === B, 'client should be in B')
  for (const [table, id] of [['service_locations', sl.id], ['analysis_scenarios', sc.id], ['upload_batches', ub.id]] as const) {
    const row: any = await must(db.from(table).select('account_id').eq('id', id).single(), `reread ${table}`)
    assert(row.account_id === B, `${table} row should have account_id B`)
  }
  const offRow: any = await must(db.from('service_offerings').select('account_id').eq('id', offering.id).single(), 'reread offering')
  assert(offRow.account_id === A, 'account-wide offering should stay in A')
  console.log('✓ move A→B re-parents children, leaves account-wide rows')

  // No-op
  const r2 = await move(clientId, { target_account_id: B })
  assert(r2.status === 200 && r2.json.moved === false, `no-op should be 200 moved=false, got ${r2.status} ${JSON.stringify(r2.json)}`)
  console.log('✓ no-op')

  // Collision
  const X = `X-${suffix}`
  await mkClient(B, X)
  const dup = await mkClient(A, X)
  const c1 = await move(dup, { target_account_id: B })
  assert(c1.status === 409, `collision should be 409, got ${c1.status}`)
  assert(c1.json.error === 'name_conflict', 'error should be name_conflict')
  assert(c1.json.conflicting_name === X, `conflicting_name should be ${X}, got ${c1.json.conflicting_name}`)

  const c2 = await move(dup, { target_account_id: B, new_name: X })
  assert(c2.status === 409, `colliding new_name should be 409, got ${c2.status}`)

  const c3 = await move(dup, { target_account_id: B, new_name: `${X} (moved)` })
  assert(c3.status === 200, `rename move should be 200, got ${c3.status} ${JSON.stringify(c3.json)}`)
  assert(c3.json.final_name === `${X} (moved)`, 'final_name should be the new name')
  console.log('✓ name collision handling')

  // Bad target
  const bad = await move(clientId, { target_account_id: randomUUID() })
  assert(bad.status === 400 && bad.json.error === 'invalid_target_account', `bad target should be 400 invalid_target_account, got ${bad.status} ${JSON.stringify(bad.json)}`)
  console.log('✓ invalid target')

  // Nonexistent client
  const nf = await move(randomUUID(), { target_account_id: B })
  assert(nf.status === 404 && nf.json?.error === 'client_not_found', `nonexistent client should be 404 client_not_found, got ${nf.status} ${JSON.stringify(nf.json)}`)
  console.log('✓ client_not_found')

  // Combined client
  const C = await mkAccount('C')
  const memberHome = await mkClient(C, `Member-Home ${suffix}`)
  const memberA = await mkClient(A, `Member-A ${suffix}`)
  await must(db.from('service_locations').insert({ account_id: C, client_id: memberHome, name: 'MH-SL' }).select('id').single(), 'member SL')
  await must(db.from('service_locations').insert({ account_id: A, client_id: memberA, name: 'MA-SL' }).select('id').single(), 'member SL A')
  const combined = await mkClient(A, `Combined ${suffix}`, { is_combined: true, member_client_ids: [memberHome, memberA] })
  const cm = await move(combined, { target_account_id: B })
  assert(cm.status === 200 && cm.json.moved === true, `combined move should be 200, got ${cm.status} ${JSON.stringify(cm.json)}`)
  const getRes = await fetch(`${BASE_URL}/api/v1/clients/${combined}`, { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } })
  assert(getRes.ok, `GET combined client → ${getRes.status}`)
  const getBody: any = await getRes.json().catch(() => null)
  assert(!!getBody && getBody.id === combined, `GET combined body should be the combined client, got ${JSON.stringify(getBody)?.slice(0, 200)}`)
  const slStats = getBody.stats ?? getBody.service_location_stats ?? getBody.sl_stats
  assert(slStats !== undefined && slStats !== null, `combined GET should include member SL stats; keys: ${Object.keys(getBody).join(',')}`)
  const slCount = typeof slStats === 'number' ? slStats : (slStats.service_location_count ?? slStats.service_locations ?? slStats.count ?? slStats.total)
  assert(typeof slCount === 'number' && slCount >= 2, `member SL stats should resolve to >= 2 SLs after move, got ${JSON.stringify(slStats)}`)
  console.log('✓ combined client move + read')

  console.log('\nAll move-client assertions passed.')
}

run()
  .catch((err) => {
    console.error(err.message ?? err)
    process.exitCode = 1
  })
  .finally(cleanup)
