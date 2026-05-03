import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Upload, AlertCircle, CheckCircle2 } from 'lucide-react'
import * as XLSX from 'xlsx'
import { useAuth } from '../../../hooks/useAuth'
import AppShell from '../../../components/layout/AppShell'
import Button from '../../../components/ui/Button'
import { Card, CardTitle } from '../../../components/ui/Card'
import { Badge } from '../../../components/ui/Badge'
import { Input, FormField, Textarea } from '../../../components/ui/Input'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../../components/ui/Table'

interface Assessment {
  id: string
  name: string
  status: string
  baseline_template_id: string | null
  client_id: string
  account_id: string
}

interface FileRow {
  id: string
  filename: string
  cycle_label: string | null
  row_count: number
  uploaded_at: string
}

interface AssessmentRowData {
  id: string
  file_id: string
  raw_address: string
  raw_scheduled_date: string | null
  raw_crew_name: string | null
  matched_service_location_id: string | null
  match_confidence: number | null
  match_status: string
  notes: string | null
}

interface SLOption {
  id: string
  display_name: string | null
  property: { address_line1: string | null } | null
}

type DiffStatus = 'only_current' | 'only_optimized' | 'moved_date' | 'matched_same'
interface DiffRow {
  status: DiffStatus
  service_location_id: string | null
  display_name: string | null
  current_date: string | null
  current_crew: string | null
  optimized_date: string | null
  optimized_crew: string | null
  hybrid_choice?: 'current' | 'optimized' | 'skip' | null
}
interface DiffPayload {
  cycle: { id: string; start_date: string; end_date: string }
  counts: { only_current: number; only_optimized: number; moved_date: number; matched_same: number }
  diff: DiffRow[]
}
interface TemplateOption {
  id: string
  name: string
  status: string
}

interface DetectedConstraint {
  id: string
  detection_type: string
  scope_type: string
  scope_ids: string[] | null
  pattern: Record<string, any>
  confidence: number
  status: 'detected' | 'accepted' | 'rejected' | 'edited'
}

const STATUS_VARIANT: Record<string, 'outline' | 'accent' | 'success' | 'warning' | 'danger'> = {
  auto: 'success',
  manual: 'success',
  pending: 'warning',
  unmatched: 'danger',
  skipped: 'outline',
}

export default function ScheduleAssessmentDetailPage() {
  const { accountId, clientId, id } = useParams<{ accountId: string; clientId: string; id: string }>()
  const { getToken } = useAuth()
  const [assessment, setAssessment] = useState<Assessment | null>(null)
  const [files, setFiles] = useState<FileRow[]>([])
  const [rows, setRows] = useState<AssessmentRowData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadCsv, setUploadCsv] = useState('')
  const [uploadName, setUploadName] = useState('')
  const [uploadCycleLabel, setUploadCycleLabel] = useState('')
  const [slOptions, setSlOptions] = useState<SLOption[]>([])
  const [templates, setTemplates] = useState<TemplateOption[]>([])
  const [diff, setDiff] = useState<DiffPayload | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffFilter, setDiffFilter] = useState<DiffStatus | 'all_actionable'>('all_actionable')
  const [detections, setDetections] = useState<DetectedConstraint[]>([])
  const [detecting, setDetecting] = useState(false)
  const [savingTpl, setSavingTpl] = useState(false)
  const [saveTplName, setSaveTplName] = useState('')
  const [savedTplId, setSavedTplId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/schedule-assessments/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? `Load failed (${res.status})`)
      setAssessment(j.assessment)
      setFiles(j.files ?? [])
      setRows(j.rows ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [id, getToken])

  useEffect(() => { load() }, [load])

  // Load this client's available templates so the user can pick a
  // baseline. Combined-aware via the existing GET endpoint.
  useEffect(() => {
    if (!accountId || !clientId) return
    let cancelled = false
    ;(async () => {
      try {
        const token = await getToken()
        const res = await fetch(
          `/api/scheduler/templates?account_id=${accountId}&client_id=${clientId}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (res.ok) {
          const j = await res.json()
          if (!cancelled) setTemplates((j.templates ?? []).filter((t: any) => t.status !== 'archived'))
        }
      } catch {
        // non-fatal
      }
    })()
    return () => { cancelled = true }
  }, [accountId, clientId, getToken])

  async function setBaselineTemplate(templateId: string | null) {
    if (!id) return
    const token = await getToken()
    await fetch(`/api/v1/schedule-assessments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ baseline_template_id: templateId }),
    })
    setAssessment((prev) => (prev ? { ...prev, baseline_template_id: templateId } : prev))
    setDiff(null) // stale
  }

  async function loadDiff() {
    if (!id) return
    setDiffLoading(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/schedule-assessments/${id}/diff`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? `Diff failed (${res.status})`)
      setDiff(j as DiffPayload)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDiffLoading(false)
    }
  }

  async function loadDetections() {
    if (!id) return
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/schedule-assessments/${id}/detect`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const j = await res.json()
        setDetections(j.constraints ?? [])
      }
    } catch {
      // non-fatal
    }
  }

  useEffect(() => { loadDetections() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function runDetection() {
    if (!id) return
    setDetecting(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/schedule-assessments/${id}/detect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? `Detection failed (${res.status})`)
      setDetections(j.constraints ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDetecting(false)
    }
  }

  async function setDetectionStatus(detId: string, status: 'accepted' | 'rejected') {
    if (!id) return
    try {
      const token = await getToken()
      await fetch(`/api/v1/schedule-assessments/${id}/detect`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: detId, status }),
      })
      setDetections((prev) => prev.map((d) => (d.id === detId ? { ...d, status } : d)))
    } catch {
      // ignore
    }
  }

  async function saveAsTemplate() {
    if (!id || !saveTplName.trim()) return
    setSavingTpl(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/schedule-assessments/${id}/save-as-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: saveTplName.trim(), regenerate: true }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? `Save failed (${res.status})`)
      setSavedTplId(j.template_id)
      await load() // refresh status
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingTpl(false)
    }
  }

  async function setHybridChoice(slId: string | null, indexAtSl: number, source: 'current' | 'optimized' | 'skip' | null) {
    if (!id || !slId) return
    const key = `${slId}|${indexAtSl}`
    try {
      const token = await getToken()
      await fetch(`/api/v1/schedule-assessments/${id}/hybrid`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rows: [{ key, source }] }),
      })
      // Optimistically patch the diff in state.
      setDiff((prev) => {
        if (!prev) return prev
        const next = { ...prev, diff: prev.diff.map((r) => r) }
        // Update each matching row by sl_id + position. Simple linear.
        let seen = 0
        next.diff = next.diff.map((r) => {
          if (r.service_location_id !== slId) return r
          const isMatch = seen === indexAtSl
          seen++
          return isMatch ? { ...r, hybrid_choice: source } : r
        })
        return next
      })
    } catch {
      // ignore
    }
  }

  // Lazy-load SL options for the manual-match dropdowns when the
  // operator opens the review tray.
  const loadSlOptions = useCallback(async () => {
    if (slOptions.length > 0 || !clientId) return
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/service-locations?client_id=${clientId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const arr = (await res.json()) as Array<{ id: string; display_name: string | null; property: any }>
        setSlOptions(arr.map((s) => ({ id: s.id, display_name: s.display_name, property: s.property })))
      }
    } catch {
      // non-fatal
    }
  }, [clientId, slOptions.length, getToken])

  async function handleFileUpload(file: File) {
    if (!id) return
    setError(null)
    const lower = file.name.toLowerCase()
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      // Parse xlsx in the browser, convert the first sheet to CSV,
      // and feed the existing CSV pipeline. xlsx is already a
      // dependency for the upload-review flow elsewhere in the app.
      try {
        const buf = await file.arrayBuffer()
        const wb = XLSX.read(buf, { type: 'array' })
        const sheetName = wb.SheetNames[0]
        if (!sheetName) throw new Error('Workbook has no sheets.')
        const sheet = wb.Sheets[sheetName]
        // raw: false formats values (dates as strings); we still re-parse
        // dates server-side for normalization. blankrows: false drops
        // empty rows the spreadsheet may have at the bottom.
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
        setUploadCsv(csv)
        setUploadName(file.name)
      } catch (e) {
        setError(e instanceof Error ? `xlsx parse failed: ${e.message}` : String(e))
      }
      return
    }
    // CSV: read as text directly.
    const text = await file.text()
    setUploadCsv(text)
    setUploadName(file.name)
  }

  async function submitUpload() {
    if (!uploadCsv || !id) return
    setUploading(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/schedule-assessments/${id}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          filename: uploadName || 'upload.csv',
          cycle_label: uploadCycleLabel || null,
          csv: uploadCsv,
        }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? `Upload failed (${res.status})`)
      setUploadCsv('')
      setUploadName('')
      setUploadCycleLabel('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  async function updateRow(rowId: string, patch: Partial<AssessmentRowData>) {
    if (!id) return
    try {
      const token = await getToken()
      await fetch(`/api/v1/schedule-assessments/${id}/rows`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          rows: [{ id: rowId, ...patch }],
        }),
      })
      // Optimistic local update so the user doesn't wait for a re-fetch.
      setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, ...patch } as AssessmentRowData : r)))
    } catch {
      // ignore — user can re-try
    }
  }

  const counts = useMemo(() => {
    let auto = 0, pending = 0, unmatched = 0, skipped = 0, manual = 0
    for (const r of rows) {
      if (r.match_status === 'auto') auto++
      else if (r.match_status === 'manual') manual++
      else if (r.match_status === 'pending') pending++
      else if (r.match_status === 'unmatched') unmatched++
      else if (r.match_status === 'skipped') skipped++
    }
    return { auto, manual, pending, unmatched, skipped, total: rows.length }
  }, [rows])

  const reviewRows = useMemo(
    () => rows.filter((r) => r.match_status === 'pending' || r.match_status === 'unmatched'),
    [rows]
  )

  if (loading) {
    return (
      <AppShell><div className="p-10 text-fg-muted">Loading…</div></AppShell>
    )
  }
  if (!assessment) {
    return (
      <AppShell><div className="p-10 text-danger">Assessment not found.</div></AppShell>
    )
  }

  return (
    <AppShell
      breadcrumb={[
        { label: 'Accounts', to: '/accounts' },
        { label: 'Smart Analysis', to: `/accounts/${accountId}/clients/${clientId}/analysis` },
        { label: 'Schedule Assessment', to: `/accounts/${accountId}/clients/${clientId}/schedule-assessment` },
        { label: assessment.name },
      ]}
    >
      <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{assessment.name}</h1>
          <p className="text-sm text-fg-muted">Status: <Badge variant="outline">{assessment.status}</Badge></p>
        </header>

        {error && <p className="text-sm text-danger">{error}</p>}

        {/* Step 1: Upload */}
        <Card className="space-y-3">
          <CardTitle>Upload schedule files</CardTitle>
          <p className="text-sm text-fg-muted">
            <strong>CSV or Excel (.xlsx / .xls)</strong>. Required: an address-like
            column (<code>address</code>, <code>property</code>, <code>building</code>,{' '}
            <code>site</code>, etc.) and at least one date column. Multi-visit
            schedules can use <code>first_visit_date</code> /{' '}
            <code>second_visit_date</code> (or <code>visit 1</code> / <code>visit 2</code>);
            each non-empty cell emits its own row. Optional <code>crew_name</code>.
            Excel files are parsed in the browser; only the first sheet is read.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Cycle label (optional)">
              <Input
                value={uploadCycleLabel}
                onChange={(e) => setUploadCycleLabel(e.target.value)}
                placeholder='e.g. "2024 cycle"'
              />
            </FormField>
            <FormField label="CSV file">
              <input
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleFileUpload(f)
                }}
                className="text-sm text-fg"
              />
            </FormField>
          </div>
          {uploadCsv && (
            <FormField label="Preview (first 200 chars)">
              <Textarea
                rows={3}
                readOnly
                value={uploadCsv.slice(0, 200) + (uploadCsv.length > 200 ? '…' : '')}
              />
            </FormField>
          )}
          <div>
            <Button onClick={submitUpload} disabled={!uploadCsv || uploading} loading={uploading}>
              <Upload className="h-4 w-4" />
              Upload
            </Button>
          </div>
        </Card>

        {files.length > 0 && (
          <Card padding="none">
            <div className="px-4 py-3 border-b border-border">
              <CardTitle>Uploaded files</CardTitle>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Filename</TableHead>
                  <TableHead>Cycle label</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead>Uploaded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-mono text-xs">{f.filename}</TableCell>
                    <TableCell className="text-xs">{f.cycle_label ?? '—'}</TableCell>
                    <TableCell numeric>{f.row_count.toLocaleString()}</TableCell>
                    <TableCell className="text-xs text-fg-muted">
                      {new Date(f.uploaded_at).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}

        {/* Step 2: Match summary */}
        {rows.length > 0 && (
          <Card className="space-y-3">
            <CardTitle>Address match summary</CardTitle>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <Stat label="Auto-matched" value={counts.auto + counts.manual} icon={<CheckCircle2 className="h-3 w-3 text-success" />} />
              <Stat label="Needs review" value={counts.pending} icon={<AlertCircle className="h-3 w-3 text-warning" />} />
              <Stat label="Unmatched" value={counts.unmatched} icon={<AlertCircle className="h-3 w-3 text-danger" />} />
              <Stat label="Skipped" value={counts.skipped} />
              <Stat label="Total" value={counts.total} />
            </div>
          </Card>
        )}

        {/* Review tray */}
        {reviewRows.length > 0 && (
          <Card padding="none">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div>
                <CardTitle>Review unmatched / low-confidence rows</CardTitle>
                <p className="text-xs text-fg-muted mt-0.5">
                  Pick the right service location, or skip rows that aren't part of this client's portfolio.
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={loadSlOptions}>
                Load SL list
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Raw address</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Crew</TableHead>
                  <TableHead className="text-right">Confidence</TableHead>
                  <TableHead>Match</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {reviewRows.slice(0, 200).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{r.raw_address}</TableCell>
                    <TableCell className="text-xs font-tabular">{r.raw_scheduled_date ?? '—'}</TableCell>
                    <TableCell className="text-xs">{r.raw_crew_name ?? '—'}</TableCell>
                    <TableCell numeric className="text-xs">
                      {r.match_confidence != null ? `${Math.round(r.match_confidence * 100)}%` : '—'}
                    </TableCell>
                    <TableCell>
                      {slOptions.length > 0 ? (
                        <select
                          value={r.matched_service_location_id ?? ''}
                          onChange={(e) =>
                            updateRow(r.id, {
                              matched_service_location_id: e.target.value || null,
                              match_status: e.target.value ? 'manual' : 'unmatched',
                            })
                          }
                          className="h-8 max-w-xs rounded-md border border-border bg-surface px-2 text-xs"
                        >
                          <option value="">— pick SL —</option>
                          {slOptions.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.display_name ?? s.property?.address_line1 ?? s.id.slice(0, 8)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-fg-subtle">click "Load SL list"</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          updateRow(r.id, { match_status: 'skipped' })
                        }
                      >
                        Skip
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {reviewRows.length > 200 && (
              <p className="px-4 py-2 text-xs text-fg-subtle border-t border-border">
                Showing 200 of {reviewRows.length} — resolve a batch and refresh.
              </p>
            )}
          </Card>
        )}

        {/* Step 3: Baseline picker — required before diff */}
        <Card className="space-y-3">
          <CardTitle>Baseline routing template</CardTitle>
          <p className="text-sm text-fg-muted">
            Pick a routing template to compare against. The diff uses that
            template's most recent generated cycle as the "optimized" side.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={assessment.baseline_template_id ?? ''}
              onChange={(e) => setBaselineTemplate(e.target.value || null)}
              className="h-9 rounded-md border border-border bg-surface px-3 text-sm text-fg max-w-md"
            >
              <option value="">— pick template —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.status})
                </option>
              ))}
            </select>
            <Button
              onClick={loadDiff}
              disabled={!assessment.baseline_template_id || diffLoading}
              loading={diffLoading}
            >
              Compare against optimized
            </Button>
          </div>
        </Card>

        {/* Step 4: Diff dashboard */}
        {diff && (
          <Card padding="none" className="overflow-hidden">
            <div className="px-4 py-3 border-b border-border space-y-2">
              <CardTitle>Current vs optimized</CardTitle>
              <p className="text-xs text-fg-muted">
                Optimized cycle: {diff.cycle.start_date} → {diff.cycle.end_date}
              </p>
              <div className="flex flex-wrap gap-2">
                <FilterChip
                  label={`All actionable (${diff.counts.only_current + diff.counts.only_optimized + diff.counts.moved_date})`}
                  active={diffFilter === 'all_actionable'}
                  onClick={() => setDiffFilter('all_actionable')}
                />
                <FilterChip
                  label={`Only on current (${diff.counts.only_current})`}
                  active={diffFilter === 'only_current'}
                  onClick={() => setDiffFilter('only_current')}
                />
                <FilterChip
                  label={`Only on optimized (${diff.counts.only_optimized})`}
                  active={diffFilter === 'only_optimized'}
                  onClick={() => setDiffFilter('only_optimized')}
                />
                <FilterChip
                  label={`Moved date (${diff.counts.moved_date})`}
                  active={diffFilter === 'moved_date'}
                  onClick={() => setDiffFilter('moved_date')}
                />
                <FilterChip
                  label={`Same (${diff.counts.matched_same})`}
                  active={diffFilter === 'matched_same'}
                  onClick={() => setDiffFilter('matched_same')}
                />
              </div>
            </div>
            <DiffTable
              rows={(() => {
                if (diffFilter === 'all_actionable') {
                  return diff.diff.filter((r) => r.status !== 'matched_same')
                }
                return diff.diff.filter((r) => r.status === diffFilter)
              })()}
              onChoice={setHybridChoice}
            />
          </Card>
        )}

        {/* Step 5: Detected constraints */}
        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle>Detected constraints</CardTitle>
            <Button size="sm" variant="secondary" onClick={runDetection} loading={detecting}>
              {detections.length === 0 ? 'Detect constraints' : 'Re-detect'}
            </Button>
          </div>
          <p className="text-sm text-fg-muted">
            Patterns the upload reveals — day-of-week avoidance, recurring
            pairs, crew/branch geographic affinity. Per-property patterns
            require 2+ files for confidence (a single 6-month or annual
            cycle has too few samples).
          </p>
          {detections.length > 0 ? (
            <ul className="space-y-2">
              {detections.map((d) => (
                <li
                  key={d.id}
                  className={
                    'rounded-md border p-3 text-sm flex items-start justify-between gap-3 ' +
                    (d.status === 'accepted'
                      ? 'border-success/40 bg-success-subtle/30'
                      : d.status === 'rejected'
                        ? 'border-fg-subtle/30 bg-surface-subtle/40 opacity-60'
                        : 'border-border bg-surface')
                  }
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="accent" className="text-[10px]">
                        {d.detection_type}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        confidence {Math.round(d.confidence * 100)}%
                      </Badge>
                      <Badge variant={d.status === 'accepted' ? 'success' : 'outline'} className="text-[10px]">
                        {d.status}
                      </Badge>
                    </div>
                    <p className="text-fg">{describeDetection(d)}</p>
                  </div>
                  {d.status !== 'accepted' && d.status !== 'rejected' && (
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" variant="ghost" onClick={() => setDetectionStatus(d.id, 'rejected')}>
                        Reject
                      </Button>
                      <Button size="sm" onClick={() => setDetectionStatus(d.id, 'accepted')}>
                        Accept
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-fg-subtle italic">
              No detections yet. Click "Detect constraints" once your matches
              are resolved.
            </p>
          )}
        </Card>

        {/* Step 6: Save as template */}
        {assessment.baseline_template_id && (
          <Card className="space-y-3">
            <CardTitle>Save hybrid as routing template</CardTitle>
            <p className="text-sm text-fg-muted">
              Promotes your accumulated diff choices into a new routing template
              alongside the baseline. Skipped rows are excluded; the new template
              regenerates immediately so you can see the engine's output for
              the hybrid set.
            </p>
            {savedTplId ? (
              <div className="rounded-md border border-success/40 bg-success-subtle/30 p-3">
                <p className="text-sm text-fg">
                  Saved as a new template.{' '}
                  <Link
                    to={`/accounts/${accountId}/clients/${clientId}/scheduler/templates/${savedTplId}`}
                    className="text-accent hover:underline"
                  >
                    Open it →
                  </Link>
                </p>
              </div>
            ) : (
              <div className="flex items-end gap-2 flex-wrap">
                <FormField label="Template name" htmlFor="hybrid-name">
                  <Input
                    id="hybrid-name"
                    value={saveTplName}
                    onChange={(e) => setSaveTplName(e.target.value)}
                    placeholder='e.g. "Hybrid 2025 — JLL"'
                    className="min-w-[20rem]"
                  />
                </FormField>
                <Button
                  onClick={saveAsTemplate}
                  loading={savingTpl}
                  disabled={!saveTplName.trim()}
                >
                  Save & regenerate
                </Button>
              </div>
            )}
          </Card>
        )}
      </div>
    </AppShell>
  )
}

function describeDetection(d: DetectedConstraint): string {
  const p = d.pattern || {}
  switch (d.detection_type) {
    case 'dow_avoidance':
      return `Schedule never uses ${p.day_of_week_name ?? 'this DOW'} (${p.sample_size ?? '?'} total visits sampled).`
    case 'workday_cap':
      return `Observed max ${p.observed_max ?? '?'} buildings/crew/day (95th percentile ${p.p95 ?? '?'}, sample ${p.sample_size ?? '?'}).`
    case 'crew_branch_affinity':
      return `${p.crew_name ?? 'Crew'} clusters within ${p.mean_spread_miles ?? '?'} mi of (${p.centroid_lat}, ${p.centroid_lng}) — looks home-based here.`
    case 'pair_recurring':
      return `Two properties scheduled together ${p.same_date_occurrences ?? '?'} times — possible co-location pairing.`
    case 'dow_per_property':
      return `Property always on ${p.day_of_week_name ?? '?'} (${p.occurrences ?? '?'} of ${p.total_visits ?? '?'} visits).`
    default:
      return JSON.stringify(p)
  }
}

function Stat({ label, value, icon }: { label: string; value: number; icon?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-surface-subtle/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-fg-subtle flex items-center gap-1">
        {icon}
        {label}
      </p>
      <p className="font-mono text-lg font-semibold text-fg tabular-nums">{value}</p>
    </div>
  )
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'rounded-md border px-2 py-0.5 text-[11px] transition-colors ' +
        (active
          ? 'border-accent bg-accent/10 text-accent'
          : 'border-border bg-surface text-fg-muted hover:text-fg')
      }
    >
      {label}
    </button>
  )
}

const STATUS_BADGE: Record<DiffStatus, { label: string; variant: 'outline' | 'accent' | 'success' | 'warning' | 'danger' }> = {
  only_current: { label: 'Only current', variant: 'danger' },
  only_optimized: { label: 'Only optimized', variant: 'accent' },
  moved_date: { label: 'Moved', variant: 'warning' },
  matched_same: { label: 'Same', variant: 'success' },
}

function DiffTable({
  rows,
  onChoice,
}: {
  rows: DiffRow[]
  onChoice: (slId: string | null, indexAtSl: number, source: 'current' | 'optimized' | 'skip' | null) => void
}) {
  // Track per-(sl_id) running index so the click handler can identify
  // which slot a row represents (multiple visits per SL are paired by
  // chronological position in the diff endpoint).
  const slCounts = new Map<string, number>()
  return (
    <div className="max-h-[600px] overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>Property</TableHead>
            <TableHead>Current</TableHead>
            <TableHead>Optimized</TableHead>
            <TableHead>Choice</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-fg-subtle text-xs italic">
                Nothing in this category.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r, i) => {
              const slKey = r.service_location_id ?? `_unmatched_${i}`
              const idxAtSl = slCounts.get(slKey) ?? 0
              slCounts.set(slKey, idxAtSl + 1)
              const meta = STATUS_BADGE[r.status]
              return (
                <TableRow key={`${slKey}-${idxAtSl}`}>
                  <TableCell>
                    <Badge variant={meta.variant} className="text-[10px]">
                      {meta.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs max-w-xs truncate">{r.display_name ?? '—'}</TableCell>
                  <TableCell className="text-xs font-tabular">
                    {r.current_date ?? '—'}
                    {r.current_crew && (
                      <p className="text-[10px] text-fg-subtle">{r.current_crew}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-xs font-tabular">
                    {r.optimized_date ?? '—'}
                    {r.optimized_crew && (
                      <p className="text-[10px] text-fg-subtle">{r.optimized_crew}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <select
                      value={r.hybrid_choice ?? ''}
                      onChange={(e) => {
                        const v = e.target.value
                        onChoice(
                          r.service_location_id,
                          idxAtSl,
                          v === '' ? null : (v as 'current' | 'optimized' | 'skip')
                        )
                      }}
                      className="h-7 rounded-md border border-border bg-surface px-2 text-xs"
                    >
                      <option value="">—</option>
                      {r.current_date && <option value="current">Keep current</option>}
                      {r.optimized_date && <option value="optimized">Use optimized</option>}
                      <option value="skip">Skip</option>
                    </select>
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
    </div>
  )
}
