import crypto from 'crypto'
import { createAdminClient } from './supabase'

export type WebhookEvent =
  | 'property.enriched'
  | 'property.updated'
  | 'service_location.created'
  | 'service_location.status_changed'

type Consumer = 'crm' | 'bid_manager'

interface ConsumerConfig {
  url: string
  secret: string
}

function getConsumers(event: WebhookEvent): ConsumerConfig[] {
  const configs: ConsumerConfig[] = []

  const crmUrl = process.env.RBM_CRM_WEBHOOK_URL
  const crmSecret = process.env.RBM_CRM_WEBHOOK_SECRET ?? process.env.SERVICE_API_KEY ?? ''
  const bidUrl = process.env.RBM_BID_MANAGER_WEBHOOK_URL
  const bidSecret = process.env.RBM_BID_MANAGER_WEBHOOK_SECRET ?? process.env.SERVICE_API_KEY ?? ''

  const crmEvents: WebhookEvent[] = [
    'property.enriched',
    'property.updated',
    'service_location.created',
    'service_location.status_changed',
  ]
  const bidEvents: WebhookEvent[] = ['property.enriched']

  if (crmUrl && crmEvents.includes(event)) configs.push({ url: crmUrl, secret: crmSecret })
  if (bidUrl && bidEvents.includes(event)) configs.push({ url: bidUrl, secret: bidSecret })

  return configs
}

function consumerLabel(url: string): Consumer {
  if (url === process.env.RBM_CRM_WEBHOOK_URL) return 'crm'
  return 'bid_manager'
}

function sign(body: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')
}

const BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000] // 1m,5m,30m,2h,12h
const MAX_ATTEMPTS = 5

async function deliverOnce(
  url: string,
  body: string,
  signature: string
): Promise<{ ok: boolean; statusCode: number | null; responseBody: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RBM-Signature': signature,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    })
    const responseBody = await res.text().catch(() => '')
    return { ok: res.ok, statusCode: res.status, responseBody }
  } catch {
    return { ok: false, statusCode: null, responseBody: '' }
  }
}

export async function fireWebhook(
  event: WebhookEvent,
  data: Record<string, unknown>
): Promise<void> {
  const consumers = getConsumers(event)
  if (!consumers.length) return

  const eventId = crypto.randomUUID()
  const payload = {
    event,
    event_id: eventId,
    timestamp: new Date().toISOString(),
    data,
  }
  const body = JSON.stringify(payload)

  for (const { url, secret } of consumers) {
    const signature = sign(body, secret)
    const consumer = consumerLabel(url)

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 2]))
      }

      const { ok, statusCode, responseBody } = await deliverOnce(url, body, signature)

      try {
        const db = createAdminClient()
        await db.from('webhook_deliveries').insert({
          event_id: eventId,
          consumer,
          url,
          attempt_number: attempt,
          status_code: statusCode,
          response_body: responseBody.slice(0, 2000),
          delivered_at: ok ? new Date().toISOString() : null,
        })
      } catch {
        // Non-fatal
      }

      if (ok) break
    }
  }
}
