import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase/client'

type Mode = 'password' | 'otp_request' | 'otp_verify'

function safeRedirect(raw: string | null): string {
  // Only allow same-origin paths to avoid open-redirect abuse.
  if (!raw) return '/'
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw
  return '/'
}

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const redirectTarget = useMemo(
    () => safeRedirect(searchParams.get('redirect')),
    [searchParams]
  )

  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // ── Password sign-in ─────────────────────────────────────────────
  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setError(error.message)
      } else {
        navigate(redirectTarget)
      }
    } finally {
      setLoading(false)
    }
  }

  // ── OTP request: send the email ──────────────────────────────────
  const handleOtpRequest = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setLoading(true)
    try {
      // emailRedirectTo lands the user on /auth/callback after they
      // click the magic link; the callback exchanges the code and
      // forwards them to redirectTarget. The 6-digit code in the
      // same email also works via verifyOtp below.
      const baseUrl = import.meta.env.VITE_APP_URL ?? window.location.origin
      const callbackUrl = `${baseUrl.replace(/\/$/, '')}/auth/callback?redirect=${encodeURIComponent(redirectTarget)}`
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: callbackUrl,
          // shouldCreateUser=false matches the "invite-only" model —
          // teammates only become users via accepting an invite, so
          // an OTP request for an unknown email shouldn't silently
          // create one.
          shouldCreateUser: false,
        },
      })
      if (error) {
        setError(error.message)
      } else {
        setInfo(
          `Sent a sign-in link + 6-digit code to ${email}. Click the link, or paste the code below.`
        )
        setMode('otp_verify')
      }
    } finally {
      setLoading(false)
    }
  }

  // ── OTP verify: paste the 6-digit code ───────────────────────────
  const handleOtpVerify = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: otpCode.trim(),
        type: 'email',
      })
      if (error) {
        setError(error.message)
      } else {
        navigate(redirectTarget)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 text-blue-400 mb-4">
            <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
            </svg>
            <span className="text-2xl font-bold text-white">RBM Geo</span>
          </div>
          <p className="text-gray-400 text-sm">Portfolio Intelligence Platform</p>
        </div>

        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 shadow-xl">
          <h2 className="text-white font-semibold text-lg mb-4">Sign in to your account</h2>

          {/* Mode switcher */}
          <div className="grid grid-cols-2 gap-1 bg-gray-900 rounded-lg p-1 mb-5 text-xs">
            <button
              type="button"
              onClick={() => {
                setMode('password')
                setError(null)
                setInfo(null)
              }}
              className={`px-3 py-1.5 rounded-md transition ${
                mode === 'password'
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Password
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('otp_request')
                setError(null)
                setInfo(null)
              }}
              className={`px-3 py-1.5 rounded-md transition ${
                mode === 'password'
                  ? 'text-gray-400 hover:text-gray-200'
                  : 'bg-gray-700 text-white'
              }`}
            >
              Email code
            </button>
          </div>

          {error && (
            <div className="mb-4 px-3 py-2 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm">
              {error}
            </div>
          )}
          {info && (
            <div className="mb-4 px-3 py-2 bg-blue-900/40 border border-blue-700 rounded-lg text-blue-200 text-sm">
              {info}
            </div>
          )}

          {/* ── Password mode ───────────────────────────────── */}
          {mode === 'password' && (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Email address
                </label>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-gray-300">Password</label>
                  <Link
                    to="/login/forgot-password"
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    Forgot password?
                  </Link>
                </div>
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="••••••••"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-medium rounded-lg px-4 py-2.5 text-sm transition-colors flex items-center justify-center gap-2"
              >
                {loading && (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}

          {/* ── OTP request mode ───────────────────────────── */}
          {mode === 'otp_request' && (
            <form onSubmit={handleOtpRequest} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Email address
                </label>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="you@example.com"
                />
              </div>
              <p className="text-xs text-gray-400">
                We'll email you a sign-in link and a 6-digit code. Either works.
              </p>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-medium rounded-lg px-4 py-2.5 text-sm transition-colors flex items-center justify-center gap-2"
              >
                {loading && (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {loading ? 'Sending…' : 'Send sign-in code'}
              </button>
            </form>
          )}

          {/* ── OTP verify mode ────────────────────────────── */}
          {mode === 'otp_verify' && (
            <form onSubmit={handleOtpVerify} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  6-digit code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  required
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-center text-lg font-mono tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="••••••"
                />
              </div>
              <button
                type="submit"
                disabled={loading || otpCode.length !== 6}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-medium rounded-lg px-4 py-2.5 text-sm transition-colors flex items-center justify-center gap-2"
              >
                {loading && (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {loading ? 'Verifying…' : 'Verify code'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('otp_request')
                  setOtpCode('')
                  setError(null)
                  setInfo(null)
                }}
                className="block w-full text-center text-xs text-gray-400 hover:text-gray-200"
              >
                ← Use a different email
              </button>
            </form>
          )}
        </div>

        {import.meta.env.VITE_ALLOW_SIGNUP === 'true' && (
          <p className="mt-4 text-center text-sm text-gray-500">
            Don't have an account?{' '}
            <Link to="/signup" className="text-blue-400 hover:text-blue-300">
              Sign up
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
