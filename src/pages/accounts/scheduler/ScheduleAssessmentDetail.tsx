import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Upload, AlertCircle, CheckCircle2 } from 'lucide-react'
import * as XLSX from 'xlsx'
import Papa from 'papaparse'
import { useAuth } from '../../../hooks/useAuth'
import AppShell from '../../../components/layout/AppShell'
import Button from '../../../components/ui/Button'
import { Card, CardTitle } from '../../../components/ui/Card'
import ScheduleAssessmentCalendar, {
  type CalendarDay,
  type CalendarSummary,
} from '../../../components/scheduler/ScheduleAssessmentCalendar'
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

interface MatchCandidate {
  sl_id: string
  address_line1: string
  score: number
  distance_feet?: number
}

interface AssessmentRowData {
  id: string
  file_id: string
  raw_address: string
  raw_scheduled_date: string | null
  raw_crew_name: string | null
  raw_location_code: string | null
  raw_city: string | null
  raw_state: string | null
  raw_postal_code: string | null
  geocoded_lat: number | null
  geocoded_lng: number | null
  geocoded_status: string | null
  matched_service_location_id: string | null
  match_confidence: number | null
  match_distance_feet: number | null
  match_status: string
  match_candidates: MatchCandidate[] | null
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
  hybrid_key?: string
  hybrid_choice?: 'current' | 'optimized' | 'skip' | null
}
interface DiffHealth {
  match_rate_pct: number
  visits_already_optimal: number
  visits_to_move: number
  visits_to_add: number
  visits_to_remove: number
  total_evaluated: number
  optimized_total_hours: number
  optimized_utilization_pct: number
  optimized_idle_days: number
  optimized_workday_count: number
}
interface DiffRecommendation {
  id: string
  kind: 'move_date' | 'add_visits' | 'remove_visits'
  title: string
  description: string
  visit_count: number
  affected_keys: string[]
  apply_choice: 'current' | 'optimized' | 'skip'
}
interface DiffPayload {
  cycle: { id: string; start_date: string; end_date: string }
  counts: { only_current: number; only_optimized: number; moved_date: number; matched_same: number }
  health?: DiffHealth
  recommendations?: DiffRecommendation[]
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
  // Column-mapping preview state. After file selection, we parse just
  // the headers + a few sample rows in the browser, show a mapping
  // table the operator can adjust, then submit on confirm.
  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [csvSample, setCsvSample] = useState<Array<Record<string, string>>>([])
  const [mapAddress, setMapAddress] = useState<string>('')
  const [mapDates, setMapDates] = useState<string[]>([])
  const [mapCrew, setMapCrew] = useState<string>('')
  const [mapLocationCode, setMapLocationCode] = useState<string>('')
  const [mapCity, setMapCity] = useState<string>('')
  const [mapState, setMapState] = useState<string>('')
  const [mapPostal, setMapPostal] = useState<string>('')
  const [geocoding, setGeocoding] = useState(false)
  const [geocodeResult, setGeocodeResult] = useState<{
    processed: number
    geocoded: number
    geocode_failed: number
    auto_matched: number
    near_matched: number
    not_in_portfolio: number
  } | null>(null)
  const [uploadName, setUploadName] = useState('')
  const [uploadCycleLabel, setUploadCycleLabel] = useState('')
  const [slOptions, setSlOptions] = useState<SLOption[]>([])
  const [templates, setTemplates] = useState<TemplateOption[]>([])
  const [diff, setDiff] = useState<DiffPayload | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [showAllDiffRows, setShowAllDiffRows] = useState(false)
  const [showConstraintsList, setShowConstraintsList] = useState(false)
  const [coachNarrative, setCoachNarrative] = useState<string | null>(null)
  const [coachLoading, setCoachLoading] = useState(false)
  const [coachError, setCoachError] = useState<string | null>(null)
  const [calendarDays, setCalendarDays] = useState<CalendarDay[] | null>(null)
  const [calendarSummary, setCalendarSummary] = useState<CalendarSummary | null>(null)
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [calendarError, setCalendarError] = useState<string | null>(null)
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
      // Auto-trigger the coach narrative in parallel so the operator sees
      // the AI review without a separate click. Cheap to skip on re-runs
      // since the user can also kick a fresh review with the button.
      void loadCoach()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDiffLoading(false)
    }
  }

  // Calendar view of the upload — month grid with visit counts and
  // total sqft per day so the operator can see at a glance whether a
  // heavy day is one big building or many small ones.
  const loadCalendar = useCallback(async () => {
    if (!id) return
    setCalendarLoading(true)
    setCalendarError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/schedule-assessments/${id}/calendar`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? `Calendar failed (${res.status})`)
      setCalendarDays(j.days as CalendarDay[])
      setCalendarSummary(j.summary as CalendarSummary)
    } catch (err) {
      setCalendarError(err instanceof Error ? err.message : String(err))
    } finally {
      setCalendarLoading(false)
    }
  }, [id, getToken])

  // Auto-load the calendar when matched rows are present so the operator
  // sees the upload visualization without an extra click.
  useEffect(() => {
    if (!id) return
    if (rows.some((r) => r.match_status === 'auto' || r.match_status === 'manual')) {
      void loadCalendar()
    }
  }, [id, rows, loadCalendar])

  // Ask the AI coach for a narrative review of the upload. Doesn't
  // require a baseline_template_id — coach gives schedule-on-its-own
  // feedback, with optimized-cycle contrast added if available.
  async function loadCoach() {
    if (!id) return
    setCoachLoading(true)
    setCoachError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/schedule-assessments/${id}/coach`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? `Coach failed (${res.status})`)
      setCoachNarrative(j.narrative as string)
    } catch (err) {
      setCoachError(err instanceof Error ? err.message : String(err))
    } finally {
      setCoachLoading(false)
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

  // Apply a recommendation: PATCH the hybrid endpoint with all of the
  // recommendation's row keys at once, then optimistically update the
  // cached diff so the UI reflects the new choices without a refetch.
  async function applyRecommendation(rec: DiffRecommendation) {
    if (!id || rec.affected_keys.length === 0) return
    const choice = rec.apply_choice
    try {
      const token = await getToken()
      await fetch(`/api/v1/schedule-assessments/${id}/hybrid`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          rows: rec.affected_keys.map((key) => ({ key, source: choice })),
        }),
      })
      const keySet = new Set(rec.affected_keys)
      setDiff((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          diff: prev.diff.map((r) =>
            r.hybrid_key && keySet.has(r.hybrid_key) ? { ...r, hybrid_choice: choice } : r
          ),
        }
      })
    } catch {
      // ignore — user can retry
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

  function autoClassify(header: string): 'address' | 'date' | 'crew' | null {
    const k = header
      .replace(/^﻿/, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
    if (!k) return null
    if (
      ['address', 'property', 'building', 'location'].some((s) => k.includes(s)) ||
      k.includes('site_name') || k.includes('site_address') || k === 'site'
    ) return 'address'
    if (['date', 'visit', 'scheduled', 'service'].some((s) => k.includes(s))) return 'date'
    if (['crew', 'team', 'tech', 'worker'].some((s) => k.includes(s))) return 'crew'
    return null
  }

  function visitIndexFromHeader(header: string): number {
    const k = header.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    const ords: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 }
    for (const [w, i] of Object.entries(ords)) if (k.startsWith(w)) return i
    const num = k.match(/(?:^|_)(\d+)(?:st|nd|rd|th)?(?:_|$)/)?.[1]
    return num ? parseInt(num, 10) : 0
  }

  async function handleFileUpload(file: File) {
    if (!id) return
    setError(null)
    setCsvHeaders([])
    setCsvSample([])
    setMapAddress('')
    setMapDates([])
    setMapCrew('')
    setMapLocationCode('')

    let csv = ''
    const lower = file.name.toLowerCase()
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      try {
        const buf = await file.arrayBuffer()
        const wb = XLSX.read(buf, { type: 'array' })
        const sheetName = wb.SheetNames[0]
        if (!sheetName) throw new Error('Workbook has no sheets.')
        const sheet = wb.Sheets[sheetName]
        csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
      } catch (e) {
        setError(e instanceof Error ? `xlsx parse failed: ${e.message}` : String(e))
        return
      }
    } else {
      csv = await file.text()
    }
    setUploadCsv(csv)
    setUploadName(file.name)

    // Parse just the headers + a few sample rows for the mapping wizard.
    const parsed = Papa.parse<Record<string, string>>(csv, {
      header: true,
      skipEmptyLines: 'greedy',
      preview: 6,
    })
    const headers = parsed.meta.fields ?? []
    setCsvHeaders(headers)
    setCsvSample(((parsed.data ?? []) as Record<string, string>[]).slice(0, 5))

    // Pre-fill mapping via the same heuristics the server uses, so the
    // common case is one click. The user can override anything.
    const addressGuess = headers.find((h) => autoClassify(h) === 'address') ?? ''
    const crewGuess = headers.find((h) => autoClassify(h) === 'crew') ?? ''
    const dateGuesses = headers
      .filter((h) => autoClassify(h) === 'date')
      .sort((a, b) => visitIndexFromHeader(a) - visitIndexFromHeader(b))
    setMapAddress(addressGuess)
    setMapCrew(crewGuess)
    setMapDates(dateGuesses)
    // Auto-detect common standalone columns for geocoding context.
    const norm = (h: string) =>
      h.replace(/^﻿/, '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    setMapCity(headers.find((h) => norm(h) === 'city') ?? '')
    setMapState(headers.find((h) => ['state', 'st', 'province'].includes(norm(h))) ?? '')
    setMapPostal(headers.find((h) => ['postal_code', 'zip', 'zip_code', 'postcode'].includes(norm(h))) ?? '')
  }

  async function submitUpload() {
    if (!uploadCsv || !id) return
    if (!mapAddress) {
      setError('Pick an Address column before uploading.')
      return
    }
    if (mapDates.length === 0) {
      setError('Pick at least one Visit-date column before uploading.')
      return
    }
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
          column_mapping: {
            address: mapAddress,
            date_columns: mapDates,
            crew: mapCrew || null,
            location_code: mapLocationCode || null,
            city: mapCity || null,
            state: mapState || null,
            postal_code: mapPostal || null,
          },
        }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? `Upload failed (${res.status})`)
      setUploadCsv('')
      setUploadName('')
      setUploadCycleLabel('')
      setCsvHeaders([])
      setCsvSample([])
      setMapAddress('')
      setMapDates([])
      setMapCrew('')
      setMapLocationCode('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  // Member clients for combined-client targets. Loaded lazily when
  // the operator opens "Add to portfolio" on a combined assessment.
  const [memberClients, setMemberClients] = useState<Array<{ id: string; name: string }>>([])
  const [addingToPortfolio, setAddingToPortfolio] = useState(false)
  const [targetClientId, setTargetClientId] = useState<string>('')

  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    ;(async () => {
      try {
        const token = await getToken()
        const res = await fetch(`/api/v1/clients/${clientId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return
        const cli = await res.json()
        if (cancelled) return
        if (cli.is_combined && Array.isArray(cli.member_client_ids) && cli.member_client_ids.length > 0) {
          // Pull member names for the dropdown.
          const all = await fetch(`/api/v1/clients`, {
            headers: { Authorization: `Bearer ${token}` },
          }).then((r) => (r.ok ? r.json() : []))
          const memberSet = new Set(cli.member_client_ids)
          const filtered = (all as Array<{ id: string; name: string; display_name: string | null }>)
            .filter((c) => memberSet.has(c.id))
            .map((c) => ({ id: c.id, name: c.display_name ?? c.name }))
          setMemberClients(filtered)
          if (filtered.length > 0) setTargetClientId(filtered[0].id)
        } else {
          setTargetClientId(clientId)
        }
      } catch {
        setTargetClientId(clientId ?? '')
      }
    })()
    return () => { cancelled = true }
  }, [clientId, getToken])

  async function addToPortfolio(rowIds: string[]) {
    if (!id) return
    if (!targetClientId) {
      setError('Pick a target client to receive the new properties.')
      return
    }
    if (rowIds.length === 0) return
    if (!confirm(`Create ${rowIds.length} new propert${rowIds.length === 1 ? 'y' : 'ies'} + service location${rowIds.length === 1 ? '' : 's'} on the target client?`)) return
    setAddingToPortfolio(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/schedule-assessments/${id}/add-to-portfolio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ row_ids: rowIds, client_id: targetClientId }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? `Add failed (${res.status})`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAddingToPortfolio(false)
    }
  }

  async function runGeocodeMatch() {
    if (!id) return
    setGeocoding(true)
    setError(null)
    setGeocodeResult(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/schedule-assessments/${id}/geocode-match`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? `Geocode failed (${res.status})`)
      setGeocodeResult({
        processed: j.processed,
        geocoded: j.geocoded,
        geocode_failed: j.geocode_failed,
        auto_matched: j.auto_matched,
        near_matched: j.near_matched,
        not_in_portfolio: j.not_in_portfolio,
      })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setGeocoding(false)
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
    () => rows.filter((r) => r.match_status === 'pending'),
    [rows]
  )
  // Rows that geocoded successfully but no SL was within 500ft —
  // candidates for "Add to portfolio" since we already have the
  // formatted address + lat/lng.
  const notInPortfolioRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.match_status === 'unmatched' &&
          typeof r.geocoded_lat === 'number' &&
          typeof r.geocoded_lng === 'number'
      ),
    [rows]
  )
  // Multi-visit uploads emit one row per visit, so the same building
  // shows up N times. Group by address so the operator sees one entry
  // per distinct property with a visit count, and so the bulk "Add"
  // creates one SL per address (server-side dedup also enforces this).
  const notInPortfolioGroups = useMemo(() => {
    const norm = (s: string | null) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
    const m = new Map<
      string,
      {
        key: string
        address: string
        city: string | null
        state: string | null
        zip: string | null
        lat: number
        lng: number
        dates: string[]
        rowIds: string[]
      }
    >()
    for (const r of notInPortfolioRows) {
      const key = `${norm(r.raw_address)}|${norm(r.raw_city)}|${norm(r.raw_state)}|${norm(r.raw_postal_code)}`
      const existing = m.get(key)
      if (existing) {
        existing.rowIds.push(r.id)
        if (r.raw_scheduled_date) existing.dates.push(r.raw_scheduled_date)
      } else {
        m.set(key, {
          key,
          address: r.raw_address,
          city: r.raw_city,
          state: r.raw_state,
          zip: r.raw_postal_code,
          lat: r.geocoded_lat as number,
          lng: r.geocoded_lng as number,
          dates: r.raw_scheduled_date ? [r.raw_scheduled_date] : [],
          rowIds: [r.id],
        })
      }
    }
    return Array.from(m.values()).sort((a, b) => a.address.localeCompare(b.address))
  }, [notInPortfolioRows])
  // Rows that couldn't be geocoded at all — bad address data.
  const ungeocodableRows = useMemo(
    () =>
      rows.filter(
        (r) => r.match_status === 'unmatched' && (r.geocoded_lat == null || r.geocoded_lng == null)
      ),
    [rows]
  )

  // Auto-load the full SL list when there are rows that need review.
  // Previously this required a manual button click — confusing because
  // dropdowns appeared empty until the operator hit it.
  useEffect(() => {
    if (reviewRows.length > 0 && slOptions.length === 0) {
      void loadSlOptions()
    }
  }, [reviewRows.length, slOptions.length, loadSlOptions])

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
          {csvHeaders.length > 0 && (
            <div className="space-y-3 rounded-md border border-border bg-surface-subtle/40 p-3">
              <p className="text-[10px] uppercase tracking-wide text-fg-subtle">
                Map columns
              </p>
              <p className="text-xs text-fg-muted">
                Auto-detected best guesses below. Adjust any that are wrong,
                add additional visit-date columns if your spreadsheet has
                them, then click Upload.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <FormField label="Address column *">
                  <select
                    value={mapAddress}
                    onChange={(e) => setMapAddress(e.target.value)}
                    className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                  >
                    <option value="">— pick column —</option>
                    {csvHeaders.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </FormField>
                <FormField
                  label="Location code (optional)"
                  helper="If your spreadsheet has an SL code that matches the SL row's location_code, it skips fuzzy matching and resolves exactly."
                >
                  <select
                    value={mapLocationCode}
                    onChange={(e) => setMapLocationCode(e.target.value)}
                    className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                  >
                    <option value="">— none —</option>
                    {csvHeaders.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Crew column (optional)">
                  <select
                    value={mapCrew}
                    onChange={(e) => setMapCrew(e.target.value)}
                    className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                  >
                    <option value="">— none —</option>
                    {csvHeaders.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </FormField>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <FormField label="City (for geocoding)">
                  <select
                    value={mapCity}
                    onChange={(e) => setMapCity(e.target.value)}
                    className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                  >
                    <option value="">— none —</option>
                    {csvHeaders.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="State (for geocoding)">
                  <select
                    value={mapState}
                    onChange={(e) => setMapState(e.target.value)}
                    className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                  >
                    <option value="">— none —</option>
                    {csvHeaders.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Postal code (for geocoding)">
                  <select
                    value={mapPostal}
                    onChange={(e) => setMapPostal(e.target.value)}
                    className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                  >
                    <option value="">— none —</option>
                    {csvHeaders.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </FormField>
              </div>
              <div>
                <p className="text-xs font-medium text-fg mb-1.5">Visit-date columns *</p>
                <p className="text-[11px] text-fg-subtle mb-2">
                  Each non-empty cell in these columns becomes one visit row.
                  Order matters (visit 1 first, visit 2 second, etc.).
                </p>
                <div className="space-y-1.5">
                  {mapDates.map((col, i) => (
                    <div key={`${col}-${i}`} className="flex items-center gap-2">
                      <span className="text-[11px] text-fg-subtle w-12 shrink-0">Visit {i + 1}</span>
                      <select
                        value={col}
                        onChange={(e) => {
                          const v = e.target.value
                          setMapDates((prev) => {
                            if (!v) return prev.filter((_, j) => j !== i)
                            const next = [...prev]
                            next[i] = v
                            return next
                          })
                        }}
                        className="h-8 flex-1 rounded-md border border-border bg-surface px-2 text-xs"
                      >
                        <option value="">— remove —</option>
                        {csvHeaders.map((h) => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-fg-subtle w-12 shrink-0">Visit {mapDates.length + 1}</span>
                    <select
                      value=""
                      onChange={(e) => {
                        const v = e.target.value
                        if (v) setMapDates((prev) => [...prev, v])
                      }}
                      className="h-8 flex-1 rounded-md border border-border bg-surface px-2 text-xs"
                    >
                      <option value="">— add column —</option>
                      {csvHeaders
                        .filter((h) => !mapDates.includes(h))
                        .map((h) => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                    </select>
                  </div>
                </div>
              </div>
              {csvSample.length > 0 && (
                <div className="overflow-x-auto">
                  <p className="text-[11px] text-fg-subtle mb-1">Sample rows:</p>
                  <table className="text-[11px] border-collapse">
                    <thead>
                      <tr>
                        {csvHeaders.map((h) => (
                          <th key={h} className="border border-border px-1.5 py-0.5 bg-surface text-left whitespace-nowrap">
                            {h}
                            {h === mapAddress && <span className="ml-1 text-accent">[addr]</span>}
                            {mapDates.includes(h) && (
                              <span className="ml-1 text-warning">[v{mapDates.indexOf(h) + 1}]</span>
                            )}
                            {h === mapCrew && <span className="ml-1 text-success">[crew]</span>}
                            {h === mapLocationCode && <span className="ml-1 text-fg-subtle">[code]</span>}
                            {h === mapCity && <span className="ml-1 text-fg-subtle">[city]</span>}
                            {h === mapState && <span className="ml-1 text-fg-subtle">[state]</span>}
                            {h === mapPostal && <span className="ml-1 text-fg-subtle">[zip]</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {csvSample.map((r, i) => (
                        <tr key={i}>
                          {csvHeaders.map((h) => (
                            <td key={h} className="border border-border px-1.5 py-0.5 text-fg-muted whitespace-nowrap">
                              {r[h] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          <div>
            <Button
              onClick={submitUpload}
              disabled={!uploadCsv || !mapAddress || mapDates.length === 0 || uploading}
              loading={uploading}
            >
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
                  <TableHead />
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
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          if (!confirm(`Delete "${f.filename}" and all ${f.row_count} parsed rows?`)) return
                          try {
                            const token = await getToken()
                            const res = await fetch(
                              `/api/v1/schedule-assessments/${id}/files/${f.id}`,
                              { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
                            )
                            if (!res.ok) {
                              const j = await res.json().catch(() => ({}))
                              throw new Error(j.error ?? `Delete failed (${res.status})`)
                            }
                            await load()
                          } catch (err) {
                            setError(err instanceof Error ? err.message : String(err))
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}

        {/* Step 2a: Geocode & match — primary resolver */}
        {rows.length > 0 && (
          <Card className="space-y-3">
            <CardTitle>Geocode &amp; match by location</CardTitle>
            <p className="text-sm text-fg-muted">
              The reliable way to resolve uploaded rows: geocode each
              address via Google, then match each row to the nearest
              service location by lat/lng. Within 50ft → auto-match.
              50–500ft → review (likely multi-SL building). Beyond →
              flagged as not in this client's portfolio (you can add
              them in a follow-up step).
            </p>
            {geocodeResult && (
              <div className="rounded-md border border-success/30 bg-success-subtle/40 p-3 text-sm space-y-1">
                <p className="font-semibold text-fg">Geocode &amp; match complete</p>
                <p className="text-fg-muted">
                  Processed {geocodeResult.processed} ({geocodeResult.geocoded} geocoded fresh,
                  {' '}{geocodeResult.geocode_failed} failed) →{' '}
                  <span className="text-success font-tabular">{geocodeResult.auto_matched} auto-matched</span>,{' '}
                  <span className="text-warning font-tabular">{geocodeResult.near_matched} near-matches</span>,{' '}
                  <span className="text-fg-subtle font-tabular">{geocodeResult.not_in_portfolio} not in portfolio</span>.
                </p>
              </div>
            )}
            <div>
              <Button onClick={runGeocodeMatch} loading={geocoding}>
                {geocodeResult ? 'Re-run geocode &amp; match' : 'Geocode & match'}
              </Button>
            </div>
          </Card>
        )}

        {/* Step 2b: Match summary */}
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
            <div className="px-4 py-3 border-b border-border">
              <CardTitle>Review {reviewRows.length} unmatched / low-confidence rows</CardTitle>
              <p className="text-xs text-fg-muted mt-0.5">
                The matcher's best guess is pre-selected in each dropdown. Just
                confirm with <strong>Accept</strong> if the top suggestion is
                right, change the selection, or <strong>Skip</strong> if the
                row isn't part of this client's portfolio.
              </p>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  onClick={async () => {
                    // Bulk-accept the top candidate on every review row that
                    // has one. The operator can still revisit individual rows
                    // afterward.
                    const accepts = reviewRows
                      .filter((r) => Array.isArray(r.match_candidates) && r.match_candidates.length > 0)
                      .map((r) => ({
                        id: r.id,
                        matched_service_location_id: r.match_candidates![0].sl_id,
                        match_status: 'manual' as const,
                      }))
                    if (accepts.length === 0) return
                    if (!confirm(`Auto-accept the top candidate for ${accepts.length} rows? You can still change individual rows after.`)) return
                    try {
                      const token = await getToken()
                      // Chunk to keep payloads sane.
                      for (let i = 0; i < accepts.length; i += 200) {
                        const chunk = accepts.slice(i, i + 200)
                        await fetch(`/api/v1/schedule-assessments/${id}/rows`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                          body: JSON.stringify({ rows: chunk }),
                        })
                      }
                      await load()
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err))
                    }
                  }}
                >
                  Accept top suggestion for all (
                  {reviewRows.filter((r) => Array.isArray(r.match_candidates) && r.match_candidates.length > 0).length}
                  )
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const skips = reviewRows
                      .filter((r) => !Array.isArray(r.match_candidates) || r.match_candidates.length === 0)
                      .map((r) => ({ id: r.id, match_status: 'skipped' as const }))
                    if (skips.length === 0) return
                    if (!confirm(`Skip ${skips.length} rows that have no candidates at all (almost certainly not in this portfolio)?`)) return
                    try {
                      const token = await getToken()
                      for (let i = 0; i < skips.length; i += 200) {
                        const chunk = skips.slice(i, i + 200)
                        await fetch(`/api/v1/schedule-assessments/${id}/rows`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                          body: JSON.stringify({ rows: chunk }),
                        })
                      }
                      await load()
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err))
                    }
                  }}
                >
                  Skip all unmatched ({reviewRows.filter((r) => !Array.isArray(r.match_candidates) || r.match_candidates.length === 0).length})
                </Button>
                {slOptions.length > 0 && (
                  <span className="text-[11px] text-fg-subtle">
                    Full SL list loaded ({slOptions.length})
                  </span>
                )}
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Raw address</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Crew</TableHead>
                  <TableHead className="text-right">Conf</TableHead>
                  <TableHead>Match</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {reviewRows.slice(0, 200).map((r) => {
                  const candidates = Array.isArray(r.match_candidates) ? r.match_candidates : []
                  const usingCandidates = candidates.length > 0
                  // Pre-select the best candidate so the dropdown isn't empty
                  // and the operator can confirm with one click.
                  const selectedValue =
                    r.matched_service_location_id ??
                    (candidates[0]?.sl_id ?? '')
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs">
                        {r.raw_address}
                        {r.raw_location_code && (
                          <span className="ml-1 text-fg-subtle">[code: {r.raw_location_code}]</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs font-tabular">{r.raw_scheduled_date ?? '—'}</TableCell>
                      <TableCell className="text-xs">{r.raw_crew_name ?? '—'}</TableCell>
                      <TableCell numeric className="text-xs">
                        {r.match_confidence != null ? `${Math.round(r.match_confidence * 100)}%` : '—'}
                      </TableCell>
                      <TableCell>
                        <select
                          value={selectedValue}
                          onChange={(e) =>
                            updateRow(r.id, {
                              matched_service_location_id: e.target.value || null,
                              match_status: e.target.value ? 'manual' : 'unmatched',
                            })
                          }
                          className="h-8 max-w-xs rounded-md border border-border bg-surface px-2 text-xs"
                        >
                          <option value="">— pick SL —</option>
                          {usingCandidates && (
                            <optgroup label="Suggested matches">
                              {candidates.map((c) => (
                                <option key={c.sl_id} value={c.sl_id}>
                                  {c.address_line1} ({Math.round(c.score * 100)}%)
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {slOptions.length > 0 && (
                            <optgroup label="All service locations">
                              {slOptions.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.display_name ?? s.property?.address_line1 ?? s.id.slice(0, 8)}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            onClick={() =>
                              updateRow(r.id, {
                                matched_service_location_id: selectedValue || null,
                                match_status: selectedValue ? 'manual' : 'unmatched',
                              })
                            }
                            disabled={!selectedValue || r.matched_service_location_id === selectedValue}
                          >
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => updateRow(r.id, { match_status: 'skipped' })}
                          >
                            Skip
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            {reviewRows.length > 200 && (
              <p className="px-4 py-2 text-xs text-fg-subtle border-t border-border">
                Showing 200 of {reviewRows.length} — resolve a batch and refresh.
              </p>
            )}
          </Card>
        )}

        {/* Not in portfolio: rows that geocoded fine but no SL was nearby.
            Grouped by address so multi-visit duplicates collapse into one row. */}
        {notInPortfolioGroups.length > 0 && (
          <Card padding="none">
            <div className="px-4 py-3 border-b border-border space-y-2">
              <CardTitle>
                Not in portfolio ({notInPortfolioGroups.length} address
                {notInPortfolioGroups.length === 1 ? '' : 'es'}
                {notInPortfolioRows.length !== notInPortfolioGroups.length
                  ? ` · ${notInPortfolioRows.length} visits`
                  : ''}
                )
              </CardTitle>
              <p className="text-xs text-fg-muted">
                Google geocoded these addresses successfully, but no existing
                service location is within 500ft. These look like real
                properties not yet in your portfolio. Multi-visit schedules
                show one row per address with a visit count — adding will
                create one property + service location for each distinct
                address and link every visit row to it.
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                {memberClients.length > 0 && (
                  <FormField label="Target client">
                    <select
                      value={targetClientId}
                      onChange={(e) => setTargetClientId(e.target.value)}
                      className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
                    >
                      {memberClients.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </FormField>
                )}
                <Button
                  size="sm"
                  onClick={() =>
                    addToPortfolio(notInPortfolioGroups.flatMap((g) => g.rowIds))
                  }
                  loading={addingToPortfolio}
                  disabled={!targetClientId}
                >
                  Add all {notInPortfolioGroups.length} to portfolio
                </Button>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Raw address</TableHead>
                  <TableHead>City / state / zip</TableHead>
                  <TableHead className="text-right">Visits</TableHead>
                  <TableHead className="text-right">Lat / lng</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {notInPortfolioGroups.slice(0, 200).map((g) => (
                  <TableRow key={g.key}>
                    <TableCell className="text-xs">{g.address}</TableCell>
                    <TableCell className="text-xs text-fg-muted">
                      {[g.city, g.state, g.zip].filter(Boolean).join(', ') || '—'}
                    </TableCell>
                    <TableCell numeric className="text-xs font-tabular">
                      {g.rowIds.length}
                    </TableCell>
                    <TableCell numeric className="text-xs font-tabular text-fg-muted">
                      {g.lat.toFixed(4)}, {g.lng.toFixed(4)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          onClick={() => addToPortfolio(g.rowIds)}
                          loading={addingToPortfolio}
                          disabled={!targetClientId}
                        >
                          Add
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            Promise.all(
                              g.rowIds.map((id) => updateRow(id, { match_status: 'skipped' }))
                            )
                          }
                        >
                          Skip
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {notInPortfolioGroups.length > 200 && (
              <p className="px-4 py-2 text-xs text-fg-subtle border-t border-border">
                Showing 200 of {notInPortfolioGroups.length} — resolve a batch and refresh.
              </p>
            )}
          </Card>
        )}

        {/* Ungeocodable rows — bad address data, can't auto-add. */}
        {ungeocodableRows.length > 0 && (
          <Card>
            <CardTitle>Couldn't geocode ({ungeocodableRows.length})</CardTitle>
            <p className="text-sm text-fg-muted mt-2">
              Google couldn't resolve these addresses. Most likely the address,
              city, or postal-code columns weren't populated correctly in the
              upload. Skip them or delete the file and re-upload with the
              right column mapping.
            </p>
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

        {/* Step 4a: Calendar view of the upload — visit counts + sqft
            per day, so the operator can tell at a glance whether a heavy
            day is one big building or many small ones. */}
        {(calendarDays && calendarSummary && calendarSummary.day_count > 0) || calendarLoading ? (
          <Card className="space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <CardTitle>Upload calendar</CardTitle>
                <p className="text-xs text-fg-muted mt-0.5">
                  Each cell shows visit count and total square footage for that day.
                  Color heat reflects sqft relative to your busiest day. Click a
                  day to see the property list.
                </p>
              </div>
              {calendarLoading && (
                <p className="text-xs text-fg-muted italic">Loading…</p>
              )}
            </div>
            {calendarError && <p className="text-sm text-danger">{calendarError}</p>}
            {calendarSummary && (calendarSummary.implausible_date_count ?? 0) > 0 && (
              <p className="text-xs text-warning bg-warning-subtle/30 border border-warning/40 rounded-md px-3 py-2">
                {calendarSummary.implausible_date_count} row
                {calendarSummary.implausible_date_count === 1 ? '' : 's'} had an
                unrealistic year (outside 1900–2200) and {calendarSummary.implausible_date_count === 1 ? 'was' : 'were'} hidden from the calendar. This usually means a non-date column was mapped as a date — re-upload with the correct mapping to recover them.
              </p>
            )}
            {calendarDays && calendarSummary && (
              <ScheduleAssessmentCalendar days={calendarDays} summary={calendarSummary} />
            )}
          </Card>
        ) : null}

        {/* Step 4: Coach narrative — AI-written feedback on the upload */}
        <Card className="space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle>Coach review</CardTitle>
              <p className="text-xs text-fg-muted mt-0.5">
                AI coaching feedback on the uploaded schedule — what's working,
                what to consider. Not a verdict against the engine; the engine
                is one possible plan among many.
              </p>
            </div>
            <Button
              size="sm"
              variant={coachNarrative ? 'secondary' : 'primary'}
              onClick={loadCoach}
              loading={coachLoading}
            >
              {coachNarrative ? 'Re-review' : 'Get coaching review'}
            </Button>
          </div>
          {coachError && <p className="text-sm text-danger">{coachError}</p>}
          {coachNarrative ? (
            <div className="rounded-md border border-border bg-surface-subtle p-4 text-sm leading-relaxed text-fg whitespace-pre-wrap">
              {coachNarrative}
            </div>
          ) : (
            !coachLoading && (
              <p className="text-xs text-fg-subtle italic">
                Click "Get coaching review" once your matches are resolved
                (and a baseline template is set, if you want optimized-cycle
                contrast).
              </p>
            )
          )}
        </Card>

        {/* Step 4b: Cycle-shape stats — kept for context, not as a verdict.
            "Already optimal" was misleading (the optimized cycle is on a
            different date window) and is dropped; we keep the optimized
            shape numbers so the operator sees what the engine produces. */}
        {diff?.health && (
          <Card className="space-y-3">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <CardTitle>Cycle shape</CardTitle>
              <p className="text-xs text-fg-muted">
                Optimized cycle: {diff.cycle.start_date} → {diff.cycle.end_date}
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-md border border-border bg-surface-subtle p-3">
                <p className="text-xs text-fg-muted uppercase tracking-wide">
                  Visits in upload
                </p>
                <p className="text-3xl font-semibold text-fg font-tabular mt-1">
                  {diff.health.visits_already_optimal +
                    diff.health.visits_to_move +
                    diff.health.visits_to_remove}
                </p>
                <p className="text-xs text-fg-muted mt-1">
                  Matched + scheduled in your upload.
                </p>
              </div>
              <div className="rounded-md border border-border bg-surface-subtle p-3">
                <p className="text-xs text-fg-muted uppercase tracking-wide">
                  Optimized utilization
                </p>
                <p className="text-3xl font-semibold text-fg font-tabular mt-1">
                  {diff.health.optimized_utilization_pct}%
                </p>
                <p className="text-xs text-fg-muted mt-1">
                  {diff.health.optimized_total_hours.toFixed(1)} work hours across{' '}
                  {diff.health.optimized_workday_count} crew-days
                  {diff.health.optimized_idle_days > 0
                    ? ` (${diff.health.optimized_idle_days} idle)`
                    : ''}
                  .
                </p>
              </div>
              <div className="rounded-md border border-border bg-surface-subtle p-3">
                <p className="text-xs text-fg-muted uppercase tracking-wide">
                  Visits engine adds
                </p>
                <p className="text-3xl font-semibold text-fg font-tabular mt-1">
                  {diff.health.visits_to_add}
                </p>
                <p className="text-xs text-fg-muted mt-1">
                  Properties the optimized cycle visits but the upload doesn't
                  include.
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* Step 4c: Detail diff table — collapsed by default. */}
        {diff && (
          <Card padding="none" className="overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAllDiffRows((v) => !v)}
              className="w-full px-4 py-3 border-b border-border flex items-center justify-between text-left hover:bg-surface-subtle transition-colors"
            >
              <div>
                <p className="font-medium text-fg">
                  {showAllDiffRows ? 'Hide' : 'Show'} per-visit detail (
                  {diff.counts.only_current +
                    diff.counts.only_optimized +
                    diff.counts.moved_date +
                    diff.counts.matched_same}{' '}
                  rows)
                </p>
                <p className="text-xs text-fg-muted mt-0.5">
                  Edit individual visit choices instead of applying a whole
                  recommendation.
                </p>
              </div>
              <span className="text-fg-muted text-sm">{showAllDiffRows ? '▾' : '▸'}</span>
            </button>
            {showAllDiffRows && (
              <>
                <div className="px-4 py-3 border-b border-border">
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
              </>
            )}
          </Card>
        )}

        {/* Step 5: Detected constraints — collapsed callout */}
        <Card className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle>Detected constraints</CardTitle>
              <p className="text-xs text-fg-muted mt-0.5">
                {detections.length > 0
                  ? `${detections.length} pattern${detections.length === 1 ? '' : 's'} detected — ${detections.filter((d) => d.status === 'accepted').length} accepted, ${detections.filter((d) => d.status === 'rejected').length} rejected, ${detections.filter((d) => d.status === 'detected' || d.status === 'edited').length} pending review.`
                  : 'Day-of-week patterns, recurring pairs, crew/branch affinity. Click to detect.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={runDetection} loading={detecting}>
                {detections.length === 0 ? 'Detect' : 'Re-detect'}
              </Button>
              {detections.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowConstraintsList((v) => !v)}
                >
                  {showConstraintsList ? 'Hide' : 'Review'}
                </Button>
              )}
            </div>
          </div>
          {showConstraintsList && detections.length > 0 && (
            <ul className="space-y-2 pt-1">
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
