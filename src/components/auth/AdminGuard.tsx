// AdminGuard wraps an authenticated page and additionally requires
// the user to have role='admin' in app_users. If the user is signed
// in but has no app_user record AND no admin exists yet, the guard
// redirects to /admin/bootstrap so they can claim the first admin
// seat. Otherwise non-admins land on /map with a notice.
import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

interface MeResponse {
  mode: string
  user_id?: string
  email?: string
  app_user: { role: 'admin' | 'member'; is_active: boolean } | null
  admin_count: number
  can_bootstrap: boolean
}

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth()
  const [me, setMe] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const token = await getToken()
        const res = await fetch('/api/v1/me', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error(`Auth check failed: ${res.status}`)
        const data = (await res.json()) as MeResponse
        if (!cancelled) setMe(data)
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !me) {
    return <Navigate to="/login" replace />
  }

  // No admin yet — let the user become the first admin.
  if (me.can_bootstrap) {
    return <Navigate to="/admin/bootstrap" replace />
  }

  if (!me.app_user || me.app_user.role !== 'admin' || !me.app_user.is_active) {
    return <Navigate to="/map" replace state={{ adminBlocked: true }} />
  }

  return <>{children}</>
}
