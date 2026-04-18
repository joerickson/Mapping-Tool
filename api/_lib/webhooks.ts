import crypto from 'crypto'
import { createAdminClient } from './supabase'

export type WebhookEvent =
  | 'property.enriched'
  | 'property.updated'
  | 'service_location.created'
  | 'service_location.status_changed'

interface WebhookPayload {
  event: WebhookEvent
  data: Record<string, unknown>
  timestamp: string
}

const WEBHOOK_URLS: Partial<Record<WebhookEvent, string[]>> = {
  'property.enriched': [
    process.env.RBM_CRM_WEBHOOK_URL,
    process.env.RBM_BID_MANAGER_WEBHOOK_URL,
  ].filter(Boolean) as string[],
  'property.updated': [
    process.env.RBM_CRM_WEBHOOK_URL,
  ].filter(Boolean) as string[],
  'service_location.created': [
    process.env.RBM_CRM_WEBHOOK_URL,
  ].filter(Boolean) as string[],
  'service_location.status_changed': [
    process.env.RBM_CRM_WEBHOOK_URL,
  ].filter(Boolean) as string[],
}

const SHARED_SECRET = process.env.SERVICE_API_KEY ?? ''
const MAX_ATTEMPTS = 5
const BACKOFF_BASE_MS = 1000

function sign(body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', SHARED_SECRET).update(body).digest('hex')
}

async function deliverOnce(url: string, body: string, signature: string): Promise<boolean> {
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
    return res.ok
  } catch {
    return false
  }
}

export async function fireWebhook(
  event: WebhookEvent,
  data: Record<string, unknown>
): Promise<void> {
  const urls = WEBHOOK_URLS[event] ?? []
  if (!urls.length) return

  const payload: WebhookPayload = {
    event,
    data,
    timestamp: new Date().toISOString(),
  }
  const body = JSON.stringify(payload)
  const signature = sign(body)

  for (const url of urls) {
    let attempt = 0
    let delivered = false

    while (attempt < MAX_ATTEMPTS && !delivered) {
      if (attempt > 0) {
        const delay = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), 24 * 60 * 60 * 1000)
        await new Promise((r) => setTimeout(r, delay))
      }

      delivered = await deliverOnce(url, body, signature)
      attempt++
    }

    // Log delivery attempt to Supabase
    try {
      const db = createAdminClient()
      await db.from('webhook_deliveries').insert({
        event,
        url,
        payload: payload,
        delivered,
        attempts: attempt,
        last_attempted_at: new Date().toISOString(),
      })
    } catch {
      // Non-fatal — don't let logging failure break webhook delivery
    }
  }
}
