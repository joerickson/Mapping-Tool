// One-shot page: shown when an authenticated user lands on /admin
// before any admin exists. Promoting yourself to first admin is a
// one-click button that hits /api/v1/admin/users/bootstrap.
import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Loader2, ShieldCheck } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import AppShell from '../../components/layout/AppShell'
import Button from '../../components/ui/Button'
import { Card, CardTitle, CardDescription } from '../../components/ui/Card'

export default function AdminBootstrapPage() {
  const { getToken } = useAuth()
  const nav = useNavigate()
  const [loading, setLoading] = useState(true)
  const [canBootstrap, setCanBootstrap] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const token = await getToken()
        const res = await fetch('/api/v1/me', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const j = await res.json()
        if (!res.ok) throw new Error(j.error ?? `Auth check failed: ${res.status}`)
        if (!cancelled) {
          setCanBootstrap(!!j.can_bootstrap)
          setEmail(j.email ?? null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [getToken])

  const claim = async () => {
    setBusy(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/v1/admin/users/bootstrap', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? `Bootstrap failed: ${res.status}`)
      nav('/admin/users', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="mx-auto max-w-xl px-6 py-16 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto" />
        </div>
      </AppShell>
    )
  }
  if (!canBootstrap) {
    return <Navigate to="/admin/users" replace />
  }

  return (
    <AppShell breadcrumb={[{ label: 'Admin' }]}>
      <div className="mx-auto max-w-xl px-6 py-12">
        <Card padding="md">
          <ShieldCheck className="h-8 w-8 text-accent mb-3" />
          <CardTitle>Claim the first admin seat</CardTitle>
          <CardDescription>
            No admin user has been set up yet. Click below to promote yourself
            ({email ?? 'this account'}) to admin so you can invite teammates.
            This option disappears as soon as the first admin exists.
          </CardDescription>
          {error && (
            <p className="mt-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <Button onClick={claim} disabled={busy} className="mt-4">
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Promoting…
              </>
            ) : (
              'Become first admin'
            )}
          </Button>
        </Card>
      </div>
    </AppShell>
  )
}
