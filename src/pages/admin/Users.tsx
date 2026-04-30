// Admin user management — invite + role + activation. All actions
// are admin-gated server-side; the page itself is wrapped in
// AdminGuard so non-admins never reach it.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Loader2,
  Mail,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserPlus,
  Copy,
  Check,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import AppShell from '../../components/layout/AppShell'
import Button from '../../components/ui/Button'
import { Card, CardTitle, CardDescription } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Input, FormField } from '../../components/ui/Input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/Select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/Table'
import { cn } from '../../lib/cn'

interface AppUser {
  id: string
  email: string
  name: string | null
  role: 'admin' | 'member'
  is_active: boolean
  created_at: string
  last_seen_at: string | null
}

interface PendingInvite {
  id: string
  email: string
  role: 'admin' | 'member'
  invited_by_email: string | null
  expires_at: string
  created_at: string
}

interface UsersResponse {
  users: AppUser[]
  pending_invites: PendingInvite[]
  admin_count: number
}

export default function AdminUsersPage() {
  const { getToken } = useAuth()
  const [data, setData] = useState<UsersResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member')
  const [inviting, setInviting] = useState(false)
  const [inviteResult, setInviteResult] = useState<{
    link: string
    sent: boolean
    error?: string
  } | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const token = await getToken()
      const res = await fetch('/api/v1/admin/users', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`Load failed: ${res.status}`)
      setData((await res.json()) as UsersResponse)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [getToken])

  useEffect(() => {
    refresh()
  }, [refresh])

  const submitInvite = async () => {
    setInviting(true)
    setError(null)
    setInviteResult(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/v1/admin/users/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? `Invite failed: ${res.status}`)
      setInviteResult({
        link: j.link,
        sent: !!j.email?.sent,
        error: j.email?.error ?? undefined,
      })
      setInviteEmail('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setInviting(false)
    }
  }

  const copyLink = (link: string) => {
    navigator.clipboard.writeText(link).then(() => {
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    })
  }

  const updateUser = async (userId: string, body: any) => {
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/admin/users/${userId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? `Update failed: ${res.status}`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const revokeInvite = async (inviteId: string) => {
    if (!window.confirm('Revoke this invite? The link will stop working.')) return
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/admin/users/invites/${inviteId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as any).error ?? `Revoke failed: ${res.status}`)
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <AppShell breadcrumb={[{ label: 'Admin', to: '/admin' }, { label: 'Users' }]}>
      <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold text-fg">User Management</h1>
          <p className="text-sm text-fg-muted mt-1">
            Invite teammates, manage roles, and deactivate accounts.
          </p>
        </header>

        {error && (
          <div className="rounded-md border border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        {/* Invite form */}
        <Card padding="md">
          <CardTitle>Invite a new user</CardTitle>
          <CardDescription>
            Sends an email if Resend is configured (RESEND_API_KEY +
            INVITE_FROM_EMAIL); otherwise you can copy the invite link from below
            and share it manually. Invites expire in 14 days.
          </CardDescription>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-[1fr_180px_auto] gap-3 items-end">
            <FormField label="Email">
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@example.com"
              />
            </FormField>
            <FormField label="Role">
              <Select
                value={inviteRole}
                onValueChange={(v) => setInviteRole(v as 'admin' | 'member')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <Button onClick={submitInvite} disabled={!inviteEmail.trim() || inviting}>
              {inviting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4 mr-1.5" />
                  Invite
                </>
              )}
            </Button>
          </div>
          {inviteResult && (
            <div
              className={cn(
                'mt-3 rounded-md border px-3 py-2 text-xs',
                inviteResult.sent
                  ? 'border-success/30 bg-success/5'
                  : 'border-warning/30 bg-warning/5'
              )}
            >
              <p className="font-medium">
                {inviteResult.sent
                  ? '✓ Invite emailed'
                  : `Email not sent: ${inviteResult.error ?? 'Resend not configured'}`}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <span className="font-mono text-fg-muted break-all flex-1">
                  {inviteResult.link}
                </span>
                <button
                  type="button"
                  onClick={() => copyLink(inviteResult.link)}
                  className="text-fg-subtle hover:text-accent"
                  title="Copy link"
                >
                  {linkCopied ? (
                    <Check className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          )}
        </Card>

        {/* Pending invites */}
        {data && data.pending_invites.length > 0 && (
          <Card padding="md">
            <CardTitle>Pending invites ({data.pending_invites.length})</CardTitle>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Invited by</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.pending_invites.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>{i.email}</TableCell>
                    <TableCell>
                      <Badge variant={i.role === 'admin' ? 'accent' : 'outline'}>
                        {i.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-fg-muted">
                      {i.invited_by_email ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs font-tabular">
                      {new Date(i.expires_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => revokeInvite(i.id)}
                        className="text-fg-subtle hover:text-danger"
                        title="Revoke invite"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}

        {/* User list */}
        <Card padding="md">
          <CardTitle>
            Users {data ? `(${data.users.length})` : ''}
          </CardTitle>
          {loading && (
            <p className="text-sm text-fg-muted mt-3 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading users…
            </p>
          )}
          {data && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.users.length === 0 && (
                  <TableRow>
                    <TableCell className="text-fg-muted text-sm">
                      No users yet — start by inviting one above.
                    </TableCell>
                  </TableRow>
                )}
                {data.users.map((u) => (
                  <TableRow key={u.id} className={!u.is_active ? 'opacity-60' : undefined}>
                    <TableCell>
                      <p className="text-fg">{u.email}</p>
                      {u.name && <p className="text-xs text-fg-muted">{u.name}</p>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.role === 'admin' ? 'accent' : 'outline'}>
                        {u.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {u.is_active ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="outline">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-tabular text-fg-muted">
                      {u.last_seen_at
                        ? new Date(u.last_seen_at).toLocaleString()
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-xs">
                        {u.role === 'member' ? (
                          <button
                            type="button"
                            onClick={() => updateUser(u.id, { role: 'admin' })}
                            className="text-fg-subtle hover:text-accent inline-flex items-center gap-1"
                            title="Promote to admin"
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                            Promote
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => updateUser(u.id, { role: 'member' })}
                            className="text-fg-subtle hover:text-warning inline-flex items-center gap-1"
                            title="Demote to member"
                          >
                            <ShieldOff className="h-3.5 w-3.5" />
                            Demote
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            updateUser(u.id, { is_active: !u.is_active })
                          }
                          className="text-fg-subtle hover:text-danger"
                          title={u.is_active ? 'Deactivate' : 'Reactivate'}
                        >
                          {u.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        <p className="text-xs text-fg-subtle">
          <Mail className="inline h-3 w-3 mr-1" />
          Email delivery uses Resend. Set <code>RESEND_API_KEY</code> and{' '}
          <code>INVITE_FROM_EMAIL</code> on Vercel to enable invite emails;
          otherwise copy the link from the invite result.{' '}
          <Link to="/admin" className="underline">
            Back to admin
          </Link>
        </p>
      </div>
    </AppShell>
  )
}
