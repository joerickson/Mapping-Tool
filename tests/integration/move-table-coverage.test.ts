/**
 * Drift guard: every public table with BOTH account_id and client_id columns
 * (other than `clients`) must be listed in MOVED_ACCOUNT_SCOPED_TABLES, which
 * drives the move endpoint's straggler sweep and mirrors move_client_to_account.
 *
 * Requires SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY.
 * Run: npx tsx tests/integration/move-table-coverage.test.ts
 */
import { createClient } from '@supabase/supabase-js'
import { MOVED_ACCOUNT_SCOPED_TABLES } from '../../api/_lib/client-move-tables.js'

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

async function run() {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    console.log('SKIP: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set')
    return
  }
  const db: any = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
  const { data, error } = await db
    .schema('information_schema')
    .from('columns')
    .select('table_name, column_name')
    .eq('table_schema', 'public')
    .in('column_name', ['account_id', 'client_id'])
  if (error) throw new Error(`FAIL: information_schema query failed: ${error.message}`)

  const cols = new Map<string, Set<string>>()
  for (const r of data as { table_name: string; column_name: string }[]) {
    if (!cols.has(r.table_name)) cols.set(r.table_name, new Set())
    cols.get(r.table_name)!.add(r.column_name)
  }
  const actual = [...cols.entries()]
    .filter(([t, c]) => t !== 'clients' && c.has('account_id') && c.has('client_id'))
    .map(([t]) => t)
  const expected: string[] = [...MOVED_ACCOUNT_SCOPED_TABLES]

  const missing = actual.filter((t) => !expected.includes(t)).sort()
  const extra = expected.filter((t) => !actual.includes(t)).sort()
  if (missing.length || extra.length) {
    throw new Error(
      `FAIL: MOVED_ACCOUNT_SCOPED_TABLES drift. Missing from constant: [${missing.join(', ')}]; ` +
        `in constant but lacking account_id+client_id: [${extra.join(', ')}]`,
    )
  }
  console.log(`✓ move table list matches schema (${expected.length} tables)`)
}

run().catch((err) => {
  console.error(err.message ?? err)
  process.exitCode = 1
})
