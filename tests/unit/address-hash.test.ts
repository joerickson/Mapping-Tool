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
