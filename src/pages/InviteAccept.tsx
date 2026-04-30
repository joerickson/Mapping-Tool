// /invite/:token landing page. Public — does NOT require an existing
// session because the recipient might not have signed up yet. Renders
// the invite metadata, then either:
//  - Shows "Sign in / sign up" links (with redirect back here) if the
//    user has no session, OR
//  - Shows a signed-in-as email + "Accept invite" button if the
//    session email matches the invite email, OR
//  - Shows a friendly "This invite is for someone else" message if
//    they're signed in as a different email.
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2, Loader2, ShieldAlert } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase/client'
import AppShell from '../components/layout/AppShell'
import Button from '../components/ui/Button'
import { Card, CardDescription, CardTitle } from '../components/ui/Card'

interface InviteInfo {
  email: string
  role: 'admin' | 'member'
  invited_by_email: string | null
  expires_at: string
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
}

export default function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>()
  const nav = useNavigate()
  const { getToken } = useAuth()
  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sessionEmail, setSessionEmail] = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`/api/v1/invites/${encodeURIComponent(token ?? '')}`)
        const j = await res.json()
        if (!res.ok) throw new Error(j.error ?? `Lookup failed: ${res.status}`)
        if (!cancelled) setInvite(j as InviteInfo)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) setSessionEmail(session?.user?.email ?? null)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!cancelled) setSessionEmail(session?.user?.email ?? null)
    })
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [token])

  const accept = useCallback(async () => {
    if (!token) return
    setAccepting(true)
    setError(null)
    try {
      const t = await getToken()
      const res = await fetch(`/api/v1/invites/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}` },
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? `Accept failed: ${res.status}`)
      setDone(true)
      setTimeout(() => nav('/map'), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAccepting(false)
    }
  }, [token, getToken, nav])

  if (loading) {
    return (
      <AppShell>
        <div className="mx-auto max-w-xl px-6 py-16 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto" />
        </div>
      </AppShell>
    )
  }

  if (error || !invite) {
    return (
      <AppShell>
        <div className="mx-auto max-w-xl px-6 py-12">
          <Card padding="md">
            <ShieldAlert className="h-8 w-8 text-danger mb-3" />
            <CardTitle>Invite not found</CardTitle>
            <CardDescription>{error ?? 'This invite link is invalid.'}</CardDescription>
          </Card>
        </div>
      </AppShell>
    )
  }

  const sameEmail =
    sessionEmail && sessionEmail.toLowerCase() === invite.email.toLowerCase()

  return (
    <AppShell>
      <div className="mx-auto max-w-xl px-6 py-12">
        <Card padding="md">
          <CardTitle>You've been invited to PortfolioIQ</CardTitle>
          <CardDescription>
            <span className="font-medium text-fg">{invite.invited_by_email ?? 'Someone'}</span>{' '}
            invited <span className="font-medium text-fg">{invite.email}</span> to join as{' '}
            <span className="font-medium text-fg">
              {invite.role === 'admin' ? 'Admin' : 'Member'}
            </span>
            .
          </CardDescription>

          {invite.status === 'expired' && (
            <p className="mt-3 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
              This invite expired on {new Date(invite.expires_at).toLocaleDateString()}. Ask the inviter for a new link.
            </p>
          )}
          {invite.status === 'revoked' && (
            <p className="mt-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
              This invite has been revoked.
            </p>
          )}
          {invite.status === 'accepted' && (
            <p className="mt-3 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">
              This invite has already been accepted. <Link to="/login" className="underline">Sign in →</Link>
            </p>
          )}

          {invite.status === 'pending' && (
            <div className="mt-4 space-y-3">
              {!sessionEmail && (
                <>
                  <p className="text-sm text-fg-muted">
                    Sign in or create your account, then come back to accept.
                  </p>
                  <div className="flex gap-2">
                    <Button asChild>
                      <Link to={`/login?redirect=/invite/${encodeURIComponent(token ?? '')}`}>
                        Sign in
                      </Link>
                    </Button>
                    <Button asChild variant="secondary">
                      <Link
                        to={`/signup?redirect=/invite/${encodeURIComponent(token ?? '')}&email=${encodeURIComponent(invite.email)}`}
                      >
                        Create account
                      </Link>
                    </Button>
                  </div>
                </>
              )}
              {sessionEmail && !sameEmail && (
                <p className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
                  You're signed in as <strong>{sessionEmail}</strong>, but this invite is for{' '}
                  <strong>{invite.email}</strong>. Sign out and sign in with the right account.
                </p>
              )}
              {sessionEmail && sameEmail && !done && (
                <Button onClick={accept} disabled={accepting}>
                  {accepting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      Accepting…
                    </>
                  ) : (
                    'Accept invite'
                  )}
                </Button>
              )}
              {done && (
                <p className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  Welcome aboard! Redirecting…
                </p>
              )}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  )
}
