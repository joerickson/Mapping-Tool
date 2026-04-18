/**
 * Integration test: New client onboarding (CRM → Geo)
 *
 * Requires:
 *   TEST_SERVICE_KEY — a valid rbm_sk_live_* key from service_api_keys table
 *   TEST_BASE_URL   — e.g. http://localhost:3000
 *
 * Run: npx tsx tests/integration/onboarding.test.ts
 */

const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3000'
const SERVICE_KEY = process.env.TEST_SERVICE_KEY ?? process.env.SERVICE_API_KEY ?? ''
const CLIENT_ID = 'test-client-onboarding-001'
const TIMEOUT_MS = 90_000

const headers = {
  'Content-Type': 'application/json',
  'X-RBM-Service-Key': SERVICE_KEY,
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`FAIL: ${msg}`)
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function run() {
  console.log('--- Onboarding integration test ---')

  // 1. POST batch of 50 addresses
  const properties = Array.from({ length: 50 }, (_, i) => ({
    address_line1: `${100 + i} Main St`,
    city: 'Chicago',
    state: 'IL',
    postal_code: `606${String(i).padStart(2, '0')}`,
    country: 'US',
    client_id: CLIENT_ID,
  }))

  const batchRes = await fetch(`${BASE_URL}/api/v1/properties`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ properties }),
  })
  assert(batchRes.ok, `POST /api/v1/properties → ${batchRes.status}`)

  const batchData = await batchRes.json()
  assert(Array.isArray(batchData), 'batch response should be array')
  assert(batchData.length === 50, `expected 50 results, got ${batchData.length}`)

  const propertyIds: string[] = batchData.map((r: any) => r.property_id).filter(Boolean)
  assert(propertyIds.length === 50, `expected 50 property_ids, got ${propertyIds.length}`)
  const enrichmentJobId = batchData[0].enrichment_job_id
  assert(!!enrichmentJobId, 'enrichment_job_id should be present')

  console.log(`✓ 50 properties created, enrichment job: ${enrichmentJobId}`)

  // 2. Poll for enrichment completion
  const deadline = Date.now() + TIMEOUT_MS
  let jobDone = false
  while (Date.now() < deadline) {
    const jobRes = await fetch(`${BASE_URL}/api/v1/enrichment-jobs/${enrichmentJobId}`, { headers })
    if (jobRes.ok) {
      const job = await jobRes.json()
      if (job.status === 'completed') { jobDone = true; break }
      if (job.status === 'failed') throw new Error('Enrichment job failed')
    }
    await sleep(2000)
  }
  assert(jobDone, 'Enrichment job did not complete within timeout')
  console.log('✓ Enrichment job completed')

  // 3. Verify enriched data readable
  const propRes = await fetch(`${BASE_URL}/api/v1/properties/${propertyIds[0]}`, { headers })
  assert(propRes.ok, `GET /api/v1/properties/:id → ${propRes.status}`)
  const propData = await propRes.json()
  assert(propData.property_id === propertyIds[0], 'property_id mismatch')
  assert(Array.isArray(propData.service_locations), 'service_locations should be array')
  console.log('✓ Enriched data readable via GET /api/v1/properties/:id')

  console.log('--- Onboarding test PASSED ---')
}

run().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
