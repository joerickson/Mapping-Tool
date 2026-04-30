// Phase 3.5 — Sync propagation
// Helper that fires a background re-synthesis whenever an account's
// state changes (selection, constraints, scenario apply, module re-run).
// Marks the latest synthesis row as 'stale' so the UI can show "Updating…"
// while a fresh run is in flight.
//
// We don't call the public /synthesize endpoint via fetch (that requires
// auth headers we don't always have in server-to-server context). Instead
// we mark stale and rely on the next dashboard interaction to trigger the
// foreground refresh — OR we call the synthesize handler directly when
// safe. For Phase 3.5, mark-stale-only is sufficient: the dashboard polls
// /synthesis-status, sees status='stale', and kicks off a foreground
// /synthesize POST automatically.
import type { SupabaseClient } from '@supabase/supabase-js'

// Debounce — at most one stale-mark per (account, 5s window). Prevents a
// rapid flurry of edits from each spawning a synthesis attempt.
const lastTriggered = new Map<string, number>()
const DEBOUNCE_MS = 5000

export async function triggerSynthesisRefresh(
  db: SupabaseClient,
  accountId: string,
  clientId: string
): Promise<void> {
  const key = `${accountId}:${clientId}`
  const now = Date.now()
  const last = lastTriggered.get(key) ?? 0
  if (now - last < DEBOUNCE_MS) return
  lastTriggered.set(key, now)

  // Find the most recent completed synthesis and flip it to 'stale'. The
  // dashboard's /synthesis-status poll will see this and trigger a fresh
  // run on the user's behalf.
  const { data: latest } = await db
    .from('portfolio_analyses')
    .select('id')
    .eq('account_id', accountId)
    .eq('client_id', clientId)
    .eq('module_key', 'synthesis')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latest) {
    await db
      .from('portfolio_analyses')
      .update({ status: 'stale' })
      .eq('id', (latest as any).id)
  }
}
