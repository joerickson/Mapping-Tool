import { useCallback } from 'react'
import { supabase } from '../lib/supabase/client'

export function useAuth() {
  const getToken = useCallback(async (): Promise<string | null> => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  }, [])

  return { getToken }
}
