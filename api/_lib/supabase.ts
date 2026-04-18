import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let adminClient: SupabaseClient | null = null

export function createAdminClient(): SupabaseClient {
  if (adminClient) return adminClient

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }

  adminClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  return adminClient
}
