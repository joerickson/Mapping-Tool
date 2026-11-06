/**
 * Integration test: admin generate/revoke client share token
 * STATUS: WRITTEN-NOT-RUN (needs a live admin user bearer token)
 *
 * Requires:
 *   TEST_ADMIN_TOKEN  — a real admin user bearer token (requireAdmin rejects service keys)
 *   TEST_BASE_URL     — e.g. http://localhost:3000
 *   SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY — for seeding
 *   TEST_MEMBER_TOKEN — optional non-admin user token (403 check)
 *
 * Run: npx tsx tests/integration/client-share-generate.test.ts
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

async function call(
  clientId: string,
  method: 'POST' | 'DELETE',
  body?: Record<string, unknown>,
  token: string | null = ADMIN_TOKEN,
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE_URL}/api/v1/clients/${clientId}/share`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  let json: any = null
  try { json = await res.json() } catch { /* empty */ }
  return { status: res.status, json }
}

async function dbToken(clientId: string) {
  const row: any = await must(
    db.from('clients').select('share_token, share_expires_at').eq('id', clientId).single(),
    'read client',
  )
  return row as { share_token: string | null; share_expires_at: string | null }
}

const suffix = randomUUID().slice(0, 8)
let accountId = ''
let clientId = ''

async function cleanup() {
  if (clientId) await db.from('clients').delete().eq('id', clientId)
  if (accountId) await db.from('accounts').delete().eq('id', accountId)
}

async function run() {
  assert(!!ADMIN_TOKEN, 'TEST_ADMIN_TOKEN is required')
  const acct: any = await must(
    db.from('accounts').insert({ name: `sharetest-${suffix}`, account_type: 'property_manager' }).select('id').single(),
    'account',
  )
  accountId = acct.id
  const cl: any = await must(
    db.from('clients').insert({ account_id: accountId, name: `Share-${suffix}`, status: 'active' }).select('id').single(),
    'client',
  )
  clientId = cl.id

  // No token -> 401, nothing minted
  const noAuth = await call(clientId, 'POST', undefined, null)
  assert(noAuth.status === 401, `no token should be 401, got ${noAuth.status}`)
  assert((await dbToken(clientId)).share_token === null, 'share_token must stay null after 401')
  console.log('✓ no token → 401')

  // Non-admin -> 403
  if (MEMBER_TOKEN) {
    const m = await call(clientId, 'POST', undefined, MEMBER_TOKEN)
    assert(m.status === 403, `non-admin should be 403, got ${m.status}`)
    assert((await dbToken(clientId)).share_token === null, 'share_token must stay null after 403')
    console.log('✓ non-admin → 403')
  } else {
    console.log('- skipped non-admin check (TEST_MEMBER_TOKEN not set)')
  }

  // POST no body -> token, never expires
  const p1 = await call(clientId, 'POST')
  assert(p1.status === 200, `POST should be 200, got ${p1.status} ${JSON.stringify(p1.json)}`)
  assert(typeof p1.json.share_token === 'string' && p1.json.share_token.length > 0, 'share_token should be non-empty')
  assert(p1.json.share_expires_at === null, `share_expires_at should be null, got ${p1.json.share_expires_at}`)
  assert((await dbToken(clientId)).share_token === p1.json.share_token, 'token persisted')
  console.log('✓ POST no body → token, null expiry')

  // POST with expires_at
  const exp = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
  const p2 = await call(clientId, 'POST', { expires_at: exp })
  assert(p2.status === 200 && !!p2.json.share_token, `POST with expiry should be 200, got ${p2.status}`)
  assert(new Date(p2.json.share_expires_at).getTime() === new Date(exp).getTime(), `expiry should be ${exp}, got ${p2.json.share_expires_at}`)
  console.log('✓ POST {expires_at} sets expiry')

  // DELETE clears
  const d = await call(clientId, 'DELETE')
  assert(d.status === 200 && d.json.share_token === null, `DELETE should be 200 {share_token:null}, got ${d.status} ${JSON.stringify(d.json)}`)
  const after = await dbToken(clientId)
  assert(after.share_token === null && after.share_expires_at === null, 'DELETE should clear token and expiry')
  console.log('✓ DELETE clears token')

  console.log('\nAll client-share-generate assertions passed.')
}

run()
  .catch((err) => {
    console.error(err.message ?? err)
    process.exitCode = 1
  })
  .finally(cleanup)
