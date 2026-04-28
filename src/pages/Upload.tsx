import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import Navbar from '../components/ui/Navbar'
import UploadDropzone from '../components/upload/UploadDropzone'
import PreviewTable from '../components/upload/PreviewTable'
import ColumnMapper from '../components/upload/ColumnMapper'
import Button from '../components/ui/Button'
import { REQUIRED_COLUMNS } from '../lib/constants'
import { normalizeCountry, validateState, validatePostalCode } from '../lib/constants/addressValidation'
import type { ColumnMapping, BatchStatusResponse } from '../types'

type Step = 'upload' | 'map' | 'validate' | 'processing'

interface ParsedData {
  columns: string[]
  rows: Record<string, unknown>[]
  filename: string
}

interface ValidationError {
  row: number
  field: string
  message: string
}

function guessMapping(columns: string[]): Partial<ColumnMapping> {
  const lower = columns.map((c) => c.toLowerCase())
  const find = (patterns: RegExp[]) => {
    for (const pat of patterns) {
      const i = lower.findIndex((c) => pat.test(c))
      if (i !== -1) return columns[i]
    }
    return undefined
  }
  return {
    address_line1: find([/^address.?line.?1/i, /^address1/i, /^addr1/i, /^street/i, /^address$/i]),
    address_line2: find([/^address.?line.?2/i, /^address2/i, /^addr2/i]),
    city: find([/^city$/i, /^city.?name/i]),
    state: find([/^state$/i, /^state.?code/i, /^province/i, /^st$/i]),
    postal_code: find([/^postal/i, /^zip/i, /^postcode/i]),
    country: find([/^country/i, /^country.?code/i]),
    location_code: find([/^location.?code/i, /^loc.?code/i, /^code$/i]),
    display_name: find([/^display.?name/i, /^name$/i, /^location.?name/i]),
    suite_or_floor: find([/^suite/i, /^floor/i, /^unit/i]),
    serviceable_sqft: find([/^sqft/i, /^sq.?ft/i, /^square.?feet/i, /^area/i]),
  }
}

function validateRows(
  rows: Record<string, unknown>[],
  mapping: ColumnMapping
): ValidationError[] {
  const errors: ValidationError[] = []

  rows.forEach((row, i) => {
    const rowNum = i + 2

    const addr = String(row[mapping.address_line1] ?? '').trim()
    if (!addr) errors.push({ row: rowNum, field: 'address_line1', message: 'Required' })

    const city = String(row[mapping.city] ?? '').trim()
    if (!city) errors.push({ row: rowNum, field: 'city', message: 'Required' })

    const rawCountry = mapping.country ? String(row[mapping.country] ?? '').trim() : ''
    const country = rawCountry ? (normalizeCountry(rawCountry) ?? 'US') : 'US'

    const state = String(row[mapping.state] ?? '').trim()
    if (!state) {
      errors.push({ row: rowNum, field: 'state', message: 'Required' })
    } else {
      const stateResult = validateState(state, country)
      if (!stateResult.valid) {
        errors.push({ row: rowNum, field: 'state', message: stateResult.error ?? `Invalid state: ${state}` })
      }
    }

    const postal = String(row[mapping.postal_code] ?? '').trim()
    if (!postal) {
      errors.push({ row: rowNum, field: 'postal_code', message: 'Required' })
    } else {
      const postalResult = validatePostalCode(postal, country)
      if (!postalResult.valid) {
        errors.push({ row: rowNum, field: 'postal_code', message: postalResult.error ?? `Invalid postal code: ${postal}` })
      }
    }
  })

  return errors
}

export default function UploadPage() {
  const { getToken } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('upload')
  const [parsed, setParsed] = useState<ParsedData | null>(null)
  const [mapping, setMapping] = useState<Partial<ColumnMapping>>({})
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [batchId, setBatchId] = useState<string | null>(null)
  const [batchStatus, setBatchStatus] = useState<BatchStatusResponse | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => () => stopPolling(), [stopPolling])

  const pollStatus = useCallback(async (id: string, token: string) => {
    try {
      const res = await fetch(`/api/uploads/${id}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const data: BatchStatusResponse = await res.json()
      setBatchStatus(data)
      if (data.status === 'completed' || data.status === 'failed') {
        stopPolling()
      }
    } catch {
      // ignore poll errors
    }
  }, [stopPolling])

  const startProcessing = useCallback(async (id: string) => {
    try {
      const token = await getToken()
      // Kick off processing in the background
      fetch(`/api/uploads/${id}/process`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {})

      // Begin polling
      pollRef.current = setInterval(() => pollStatus(id, token), 2000)
      // Poll immediately too
      pollStatus(id, token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start processing')
    }
  }, [getToken, pollStatus])

  const handleFile = useCallback((file: File) => {
    setError(null)
    const ext = file.name.split('.').pop()?.toLowerCase()

    if (ext === 'csv') {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const columns = results.meta.fields ?? []
          const rows = results.data as Record<string, unknown>[]
          setParsed({ columns, rows, filename: file.name })
          setMapping(guessMapping(columns))
          setStep('map')
        },
        error: (err) => setError(err.message),
      })
    } else {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const data = e.target?.result
          const workbook = XLSX.read(data, { type: 'binary' })
          const sheet = workbook.Sheets[workbook.SheetNames[0]]
          const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
          const columns = rows.length ? Object.keys(rows[0]) : []
          setParsed({ columns, rows, filename: file.name })
          setMapping(guessMapping(columns))
          setStep('map')
        } catch {
          setError('Failed to parse file')
        }
      }
      reader.readAsBinaryString(file)
    }
  }, [])

  const handleValidate = () => {
    if (!parsed) return
    const fullMapping = mapping as ColumnMapping
    const errs = validateRows(parsed.rows, fullMapping)
    setValidationErrors(errs)
    setStep('validate')
  }

  const handleConfirm = async () => {
    if (!parsed) return
    setSubmitting(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          filename: parsed.filename,
          rows: parsed.rows,
          mapping,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const { batchId: id } = await res.json()
      setBatchId(id)
      setBatchStatus(null)
      setStep('processing')
      await startProcessing(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDownloadInvalid = () => {
    if (!batchStatus?.summary || !parsed) return
    // Build CSV of rows that have validation errors from client-side pass
    const invalidRows = validationErrors
      .map((e) => e.row - 2)
      .filter((v, i, a) => a.indexOf(v) === i)
      .map((idx) => parsed.rows[idx])
      .filter(Boolean)
    if (!invalidRows.length) return
    const cols = Object.keys(invalidRows[0])
    const csv = [
      cols.join(','),
      ...invalidRows.map((r) =>
        cols.map((c) => JSON.stringify(r[c] ?? '')).join(',')
      ),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'invalid_rows.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const isMappingComplete = REQUIRED_COLUMNS.every((col) => mapping[col])
  const STEP_LABELS: Step[] = ['upload', 'map', 'validate', 'processing']

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <Navbar />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">Upload Service Locations</h1>

          {/* Steps indicator */}
          <div className="flex items-center gap-2 mb-8">
            {STEP_LABELS.map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-medium
                    ${step === s ? 'bg-blue-600 text-white' : i < STEP_LABELS.indexOf(step) ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-500'}`}
                >
                  {i + 1}
                </div>
                <span className={`text-sm ${step === s ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>
                  {s === 'processing' ? 'Processing' : s.charAt(0).toUpperCase() + s.slice(1)}
                </span>
                {i < STEP_LABELS.length - 1 && <div className="w-8 h-px bg-gray-300" />}
              </div>
            ))}
          </div>

          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {step === 'upload' && (
            <div className="bg-white rounded-xl p-6 shadow-sm border">
              <UploadDropzone onFile={handleFile} />
            </div>
          )}

          {step === 'map' && parsed && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl p-6 shadow-sm border">
                <h2 className="font-semibold text-gray-800 mb-4">
                  Preview: {parsed.filename} ({parsed.rows.length} rows)
                </h2>
                <PreviewTable columns={parsed.columns} rows={parsed.rows.slice(0, 10)} />
              </div>
              <div className="bg-white rounded-xl p-6 shadow-sm border">
                <h2 className="font-semibold text-gray-800 mb-4">Column Mapping</h2>
                <ColumnMapper
                  sourceColumns={parsed.columns}
                  mapping={mapping}
                  onChange={setMapping}
                />
              </div>
              <div className="flex justify-end gap-3">
                <Button variant="secondary" onClick={() => setStep('upload')}>Back</Button>
                <Button onClick={handleValidate} disabled={!isMappingComplete}>
                  Validate Data
                </Button>
              </div>
            </div>
          )}

          {step === 'validate' && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl p-6 shadow-sm border">
                <h2 className="font-semibold text-gray-800 mb-4">Validation Results</h2>
                {validationErrors.length === 0 ? (
                  <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg text-green-700">
                    <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    All {parsed?.rows.length} rows passed validation
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="p-3 bg-yellow-50 rounded-lg text-yellow-800 text-sm">
                      {validationErrors.length} validation error(s) found. Rows with errors will be flagged for review.
                    </div>
                    <div className="max-h-64 overflow-y-auto space-y-1">
                      {validationErrors.slice(0, 50).map((e, i) => (
                        <div key={i} className="text-sm text-red-600 px-2">
                          Row {e.row}: {e.field} — {e.message}
                        </div>
                      ))}
                      {validationErrors.length > 50 && (
                        <div className="text-sm text-gray-500 px-2">
                          ...and {validationErrors.length - 50} more
                        </div>
                      )}
                    </div>
                    {validationErrors.length > 0 && (
                      <button
                        onClick={handleDownloadInvalid}
                        className="text-sm text-blue-600 hover:underline px-2"
                      >
                        Download invalid rows as CSV
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-3">
                <Button variant="secondary" onClick={() => setStep('map')}>Back</Button>
                <Button onClick={handleConfirm} loading={submitting}>
                  {validationErrors.length > 0 ? 'Continue with Valid Rows' : 'Upload & Process'}
                </Button>
              </div>
            </div>
          )}

          {step === 'processing' && (
            <ProcessingStep
              batchStatus={batchStatus}
              totalRows={parsed?.rows.length ?? 0}
              onReview={() => batchId && navigate(`/upload/${batchId}/review`)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function ProcessingStep({
  batchStatus,
  totalRows,
  onReview,
}: {
  batchStatus: BatchStatusResponse | null
  totalRows: number
  onReview: () => void
}) {
  const status = batchStatus?.status ?? 'queued'
  const processed = batchStatus?.rows_processed ?? 0
  const total = batchStatus?.total_rows ?? totalRows
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0
  const summary = batchStatus?.summary

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl p-6 shadow-sm border">
        <h2 className="font-semibold text-gray-800 mb-4">
          {status === 'completed' ? 'Processing Complete' : 'Processing Upload…'}
        </h2>

        {status !== 'completed' && status !== 'failed' && (
          <div className="space-y-3">
            <div className="flex justify-between text-sm text-gray-600">
              <span>{processed.toLocaleString()} of {total.toLocaleString()} rows</span>
              <span>{pct}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className="bg-blue-600 h-2.5 rounded-full transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-sm text-gray-500">
              {status === 'queued' ? 'Queued — starting soon…' : 'Scrubbing and validating addresses…'}
            </p>
          </div>
        )}

        {status === 'failed' && (
          <div className="p-4 bg-red-50 rounded-lg text-red-700 text-sm">
            Processing failed: {batchStatus?.error ?? 'Unknown error'}
          </div>
        )}

        {status === 'completed' && summary && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <SummaryStat label="Total" value={summary.total} color="gray" />
              <SummaryStat label="Valid" value={summary.clean + summary.auto_corrected} color="green" />
              <SummaryStat label="Auto-corrected" value={summary.auto_corrected} color="yellow" />
              <SummaryStat label="Needs review" value={summary.needs_review} color="red" />
            </div>
            {summary.duplicate + summary.existing_property > 0 && (
              <p className="text-sm text-gray-500">
                {summary.duplicate + summary.existing_property} duplicate(s) detected and excluded.
              </p>
            )}
            {batchStatus.auto_corrections_count > 0 && (
              <p className="text-sm text-yellow-700 bg-yellow-50 rounded-lg px-3 py-2">
                {batchStatus.auto_corrections_count} auto-correction(s) applied (e.g. province names, postal formatting).
                These are flagged in the review step but do not block proceeding.
              </p>
            )}
            <div className="flex justify-end pt-2">
              <Button onClick={onReview}>Proceed to Review</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryStat({ label, value, color }: { label: string; value: number; color: 'green' | 'yellow' | 'red' | 'gray' }) {
  const colors = {
    green: 'text-green-600',
    yellow: 'text-yellow-600',
    red: 'text-red-600',
    gray: 'text-gray-700',
  }
  return (
    <div className="flex flex-col">
      <span className={`text-2xl font-bold ${colors[color]}`}>{value.toLocaleString()}</span>
      <span className="text-xs text-gray-500">{label}</span>
    </div>
  )
}
