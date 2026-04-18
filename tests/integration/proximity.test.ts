/**
 * Integration test: Bid proximity (Bid Manager → Geo)
 *
 * Run: npx tsx tests/integration/proximity.test.ts
 */

const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3000'
const SERVICE_KEY = process.env.TEST_SERVICE_KEY ?? process.env.SERVICE_API_KEY ?? ''
const TIMEOUT_MS = 60_000

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
  console.log('--- Proximity integration test ---')

  // 1. POST 3 prospect addresses (no client_id)
  const prospects = [
    { address_line1: '233 S Wacker Dr', city: 'Chicago', state: 'IL', postal_code: '60606' },
    { address_line1: '875 N Michigan Ave', city: 'Chicago', state: 'IL', postal_code: '60611' },
    { address_line1: '111 W Monroe St', city: 'Chicago', state: 'IL', postal_code: '60603' },
  ]

  const postRes = await fetch(`${BASE_URL}/api/v1/properties`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ properties: prospects }),
  })
  assert(postRes.ok, `POST /api/v1/properties → ${postRes.status}`)

  const postData = await postRes.json()
  assert(Array.isArray(postData) && postData.length === 3, 'expected 3 properties')

  const propertyIds: string[] = postData.map((r: any) => r.property_id).filter(Boolean)
  const jobId = postData[0].enrichment_job_id
  console.log(`✓ 3 prospect properties created, job: ${jobId}`)

  // 2. Wait for geocoding (need lat/lng for proximity)
  if (jobId) {
    const deadline = Date.now() + TIMEOUT_MS
    while (Date.now() < deadline) {
      const jobRes = await fetch(`${BASE_URL}/api/v1/enrichment-jobs/${jobId}`, { headers })
      if (jobRes.ok) {
        const job = await jobRes.json()
        if (job.status === 'completed' || job.status === 'failed') break
      }
      await sleep(3000)
    }
  }

  // 3. Call proximity
  const idsParam = propertyIds.join(',')
  const proxRes = await fetch(
    `${BASE_URL}/api/v1/proximity?property_ids=${idsParam}&radius_miles=15`,
    { headers }
  )
  assert(proxRes.ok, `GET /api/v1/proximity → ${proxRes.status}`)

  const proxData = await proxRes.json()
  assert(Array.isArray(proxData.query_points), 'query_points should be array')
  assert(Array.isArray(proxData.results), 'results should be array')

  console.log(`✓ Proximity returned ${proxData.results.length} result groups`)

  for (const qp of proxData.results) {
    assert(typeof qp.nearby_service_locations_count === 'number', 'count should be number')
    if (qp.nearby_service_locations_count > 0) {
      assert(typeof qp.closest_miles === 'number', 'closest_miles should be number')
      assert(qp.closest_miles <= 15, `closest_miles ${qp.closest_miles} should be ≤ 15`)
    }
  }

  console.log('--- Proximity test PASSED ---')
}

run().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
