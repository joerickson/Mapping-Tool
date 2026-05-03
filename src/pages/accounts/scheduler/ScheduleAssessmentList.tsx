import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Plus, Sparkles } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import AppShell from '../../../components/layout/AppShell'
import Button from '../../../components/ui/Button'
import { Card, CardTitle } from '../../../components/ui/Card'
import { Badge } from '../../../components/ui/Badge'
import { EmptyState } from '../../../components/ui/EmptyState'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '../../../components/ui/Dialog'
import { Input, FormField } from '../../../components/ui/Input'

interface AssessmentRow {
  id: string
  name: string
  status: string
  baseline_template_id: string | null
  created_at: string
  updated_at: string
}

const STATUS_VARIANT: Record<string, 'outline' | 'accent' | 'success' | 'warning'> = {
  draft: 'outline',
  matched: 'accent',
  baseline: 'warning',
  finalized: 'success',
}

export default function ScheduleAssessmentListPage() {
  const { accountId, clientId } = useParams<{ accountId: string; clientId: string }>()
  const { getToken } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState<AssessmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const load = useCallback(async () => {
    if (!clientId) return
    setLoading(true)
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/schedule-assessments?client_id=${clientId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? `Load failed (${res.status})`)
      setItems(j.assessments ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [clientId, getToken])

  useEffect(() => { load() }, [load])

  return (
    <AppShell
      breadcrumb={[
        { label: 'Accounts', to: '/accounts' },
        { label: 'Smart Analysis', to: `/accounts/${accountId}/clients/${clientId}/analysis` },
        { label: 'Schedule Assessment' },
      ]}
    >
      <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-fg flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-accent" />
              Schedule Assessment
            </h1>
            <p className="text-sm text-fg-muted max-w-2xl">
              Upload one or more historical schedules. The app matches them
              against this client's properties, detects implicit constraints
              from the patterns, generates an optimized baseline, and lets
              you iterate to a hybrid you can save as a routing template.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            New assessment
          </Button>
        </header>

        {error && <p className="text-sm text-danger">{error}</p>}

        {loading ? (
          <p className="text-sm text-fg-muted">Loading…</p>
        ) : items.length === 0 ? (
          <EmptyState
            title="No assessments yet"
            description="Create one to upload your current schedule and compare against an optimized version."
          />
        ) : (
          <div className="space-y-2">
            {items.map((a) => (
              <Card key={a.id} className="flex items-center justify-between gap-4">
                <div className="space-y-0.5 min-w-0">
                  <Link
                    to={`/accounts/${accountId}/clients/${clientId}/schedule-assessment/${a.id}`}
                    className="text-base font-semibold text-accent hover:underline"
                  >
                    {a.name}
                  </Link>
                  <p className="text-xs text-fg-muted">
                    Updated {new Date(a.updated_at).toLocaleString()}
                  </p>
                </div>
                <Badge variant={STATUS_VARIANT[a.status] ?? 'outline'}>
                  {a.status}
                </Badge>
              </Card>
            ))}
          </div>
        )}
      </div>

      {createOpen && (
        <CreateAssessmentDialog
          accountId={accountId!}
          clientId={clientId!}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) =>
            navigate(`/accounts/${accountId}/clients/${clientId}/schedule-assessment/${id}`)
          }
        />
      )}
    </AppShell>
  )
}

function CreateAssessmentDialog({
  accountId,
  clientId,
  onClose,
  onCreated,
}: {
  accountId: string
  clientId: string
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const { getToken } = useAuth()
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function create() {
    if (!name.trim()) { setErr('Name is required'); return }
    setCreating(true)
    setErr(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/schedule-assessments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          account_id: accountId,
          client_id: clientId,
          name: name.trim(),
        }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? `Create failed (${res.status})`)
      onCreated(j.assessment.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New schedule assessment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <FormField label="Name">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='e.g. "2025 schedule review"'
            />
          </FormField>
          {err && <p className="text-xs text-danger">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={creating}>Cancel</Button>
          <Button onClick={create} loading={creating}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
