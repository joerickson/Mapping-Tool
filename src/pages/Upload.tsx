import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import Navbar from '../components/ui/Navbar'
import UploadDropzone from '../components/upload/UploadDropzone'
import PreviewTable from '../components/upload/PreviewTable'
import ColumnMapper from '../components/upload/ColumnMapper'
import Button from '../components/ui/Button'
import { REQUIRED_COLUMNS, US_STATES } from '../lib/constants'
import type { ColumnMapping } from '../types'

type Step = 'upload' | 'map' | 'validate' | 'confirm'

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
    state: find([/^state$/i, /^state.?code/i, /^st$/i]),
    postal_code: find([/^postal/i, /^zip/i, /^postcode/i]),
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
    const rowNum = i + 2 // 1-indexed + header

    const addr = String(row[mapping.address_line1] ?? '').trim()
    if (!addr) errors.push({ row: rowNum, field: 'address_line1', message: 'Required' })

    const city = String(row[mapping.city] ?? '').trim()
    if (!city) errors.push({ row: rowNum, field: 'city', message: 'Required' })

    const state = String(row[mapping.state] ?? '').trim().toUpperCase()
    if (!state) {
      errors.push({ row: rowNum, field: 'state', message: 'Required' })
    } else if (!US_STATES.includes(state)) {
      errors.push({ row: rowNum, field: 'state', message: `Invalid state code: ${state}` })
    }

    const zip = String(row[mapping.postal_code] ?? '').trim()
    if (!zip) {
      errors.push({ row: rowNum, field: 'postal_code', message: 'Required' })
    } else if (!/^\d{5}(-\d{4})?$/.test(zip)) {
      errors.push({ row: rowNum, field: 'postal_code', message: `Invalid format: ${zip}` })
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
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
        } catch (err) {
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
      const { jobId: id } = await res.json()
      setJobId(id)
      setStep('confirm')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setSubmitting(false)
    }
  }

  const isMappingComplete = REQUIRED_COLUMNS.every((col) => mapping[col])

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <Navbar />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">Upload Service Locations</h1>

          {/* Steps indicator */}
          <div className="flex items-center gap-2 mb-8">
            {(['upload', 'map', 'validate', 'confirm'] as Step[]).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-medium
                    ${step === s ? 'bg-blue-600 text-white' : i < (['upload','map','validate','confirm'] as Step[]).indexOf(step) ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-500'}`}
                >
                  {i + 1}
                </div>
                <span className={`text-sm ${step === s ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </span>
                {i < 3 && <div className="w-8 h-px bg-gray-300" />}
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
                      {validationErrors.length} validation error(s) found. Rows with errors will be skipped.
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
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-3">
                <Button variant="secondary" onClick={() => setStep('map')}>Back</Button>
                <Button onClick={handleConfirm} loading={submitting}>
                  {validationErrors.length > 0 ? 'Continue with Valid Rows' : 'Start Enrichment'}
                </Button>
              </div>
            </div>
          )}

          {step === 'confirm' && (
            <div className="bg-white rounded-xl p-8 shadow-sm border text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Upload Successful</h2>
              <p className="text-gray-500 mb-6">
                Enrichment job <code className="bg-gray-100 px-1 rounded">{jobId}</code> is running.
                Properties will appear on the map as they are enriched.
              </p>
              <div className="flex justify-center gap-3">
                <Button variant="secondary" onClick={() => { setStep('upload'); setParsed(null); setMapping({}) }}>
                  Upload Another
                </Button>
                <Button onClick={() => navigate('/map')}>View Map</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
