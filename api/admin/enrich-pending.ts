import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../_lib/supabase.js'
import { authenticateRequest } from '../_lib/auth.js'

// 5-minute timeout — processing 1000 properties at 10 concurrency takes ~2 min
export const config = { maxDuration: 300 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err) {
    const e = err as { statusCode?: number; message?: string }
    return res.status(e.statusCode ?? 401).json({ error: e.message ?? 'Unauthorized' })
  }

  const db = createAdminClient()
  const baseUrl = process.env.VITE_APP_URL || `https://${req.headers.host}`

  const { data: properties, error } = await db
    .from('properties')
    .select('id')
    .in('enrichment_status', ['pending', 'failed'])
    .limit(1000)

  if (error) return res.status(500).json({ error: error.message })
  if (!properties?.length) return res.status(200).json({ message: 'No pending properties', count: 0 })

  let succeeded = 0
  let failed = 0
  const concurrency = 10 // Google Address Validation rate limit is 50 QPS

  for (let i = 0; i < properties.length; i += concurrency) {
    const chunk = properties.slice(i, i + concurrency)
    const results = await Promise.allSettled(
      chunk.map((p) =>
        fetch(`${baseUrl}/api/properties/${p.id}/enrich`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-RBM-Service-Key': process.env.SERVICE_API_KEY ?? '',
          },
        }).then((r) => r.ok)
      )
    )
    succeeded += results.filter((r) => r.status === 'fulfilled' && r.value).length
    failed += results.filter(
      (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value)
    ).length

    // Small delay to stay well under 50 QPS
    await new Promise((r) => setTimeout(r, 200))
  }

  return res.status(200).json({
    total: properties.length,
    succeeded,
    failed,
  })
}
