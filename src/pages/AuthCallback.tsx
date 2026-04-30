// /auth/callback — landing page for Supabase magic-link redirects.
// Exchanges the `code` query param for a session via
// supabase.auth.exchangeCodeForSession, then forwards to the
// `redirect` query param (or "/" if absent). The Supabase client
// also processes hash-fragment tokens automatically on load via the
// 'detectSessionInUrl' default, so the link with a hash works too.
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase/client'

function safeRedirect(raw: string | null): string {
  if (!raw) return '/'
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw
  return '/'
}

export default function AuthCallbackPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const target = safeRedirect(searchParams.get('redirect'))
    const code = searchParams.get('code')

    const finish = (path: string) => navigate(path, { replace: true })

    const run = async () => {
      // Code-flow link (e.g. PKCE / magic-link with ?code=...)
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          setError(error.message)
          return
        }
        finish(target)
        return
      }
      // Hash-fragment link (older magic-link format with #access_token=...).
      // The Supabase client auto-detects this on load; just check the
      // session and forward.
      const { data } = await supabase.auth.getSession()
      if (data.session) {
        finish(target)
        return
      }
      // Wait briefly for the SDK's URL-hash handler to populate, then
      // re-check once.
      setTimeout(async () => {
        const { data: again } = await supabase.auth.getSession()
        if (again.session) finish(target)
        else setError('No session found from the link. The link may have expired or already been used.')
      }, 400)
    }
    run()
  }, [searchParams, navigate])

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-gray-800 rounded-xl border border-gray-700 p-6 shadow-xl">
        {error ? (
          <>
            <h2 className="text-white font-semibold text-lg mb-2">Couldn't sign you in</h2>
            <p className="text-sm text-red-300 mb-4">{error}</p>
            <a
              href="/login"
              className="inline-block px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500"
            >
              Back to sign in
            </a>
          </>
        ) : (
          <div className="flex items-center gap-2 text-gray-300">
            <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Signing you in…</span>
          </div>
        )}
      </div>
    </div>
  )
}
