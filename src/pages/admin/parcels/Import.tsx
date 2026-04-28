import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'

interface ImportJob {
  id: string
  status: 'pending' | 'importing' | 'completed' | 'failed'
  parcel_count: number | null
  error_log: Record<string, unknown>[] | null
  started_at: string | null
  completed_at: string | null
  county_name: string
  state: string
  source_refresh_date: string | null
}

export default function ParcelImportPage() {
  const { getToken } = useAuth()
  const navigate = useNavigate()

  const [file, setFile] = useState<File | null>(null)
  const [countyFips, setCountyFips] = useState('')
  const [countyName, setCountyName] = useState('')
  const [state, setState] = useState('')
  const [refreshDate, setRefreshDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [importJob, setImportJob] = useState<ImportJob | null>(null)
  const [pollingId, setPollingId] = useState<ReturnType<typeof setInterval> | null>(null)

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) setFile(accepted[0])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/zip': ['.zip'],
      'text/csv': ['.csv'],
      'application/geo+json': ['.geojson'],
      'application/json': ['.json'],
    },
    maxFiles: 1,
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return setError('Please select a file')
    if (!/^\d{5}$/.test(countyFips)) return setError('County FIPS must be 5 digits')
    if (!countyName) return setError('County name is required')
    if (!/^[A-Za-z]{2}$/.test(state)) return setError('State must be a 2-letter abbreviation')

    setSubmitting(true)
    setError(null)

    try {
      const token = await getToken()
      const form = new FormData()
      form.append('file', file)
      form.append('county_fips', countyFips)
      form.append('county_name', countyName)
      form.append('state', state.toUpperCase())
      if (refreshDate) form.append('source_refresh_date', refreshDate)

      const res = await fetch('/api/v1/admin/parcels/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })

      if (!res.ok) {
        const { error: msg } = await res.json()
        throw new Error(msg ?? 'Upload failed')
      }

      const { import_id } = await res.json()
      startPolling(import_id, token!)
    } catch (err) {
      setError(String(err))
      setSubmitting(false)
    }
  }

  function startPolling(importId: string, token: string) {
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/admin/parcels/import/${importId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const job: ImportJob = await res.json()
        setImportJob(job)

        if (job.status === 'completed' || job.status === 'failed') {
          clearInterval(id)
          setPollingId(null)
          setSubmitting(false)
        }
      } catch {
        // ignore transient polling errors
      }
    }, 2000)
    setPollingId(id)
  }

  const elapsed =
    importJob?.started_at && importJob.status === 'importing'
      ? Math.round((Date.now() - new Date(importJob.started_at).getTime()) / 1000)
      : importJob?.started_at && importJob?.completed_at
      ? Math.round(
          (new Date(importJob.completed_at).getTime() - new Date(importJob.started_at).getTime()) /
            1000
        )
      : null

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Import County Parcel Data</h1>

      {importJob ? (
        <div className="border rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              {importJob.county_name}, {importJob.state}
            </h2>
            <span
              className={`text-sm px-2 py-1 rounded-full font-medium ${
                importJob.status === 'completed'
                  ? 'bg-green-100 text-green-700'
                  : importJob.status === 'failed'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-yellow-100 text-yellow-700'
              }`}
            >
              {importJob.status}
            </span>
          </div>

          {/* Progress bar */}
          {(importJob.status === 'importing' || importJob.status === 'pending') && (
            <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full animate-pulse w-full" />
            </div>
          )}

          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-gray-500">Parcels imported</dt>
            <dd className="font-medium">{importJob.parcel_count?.toLocaleString() ?? '—'}</dd>
            <dt className="text-gray-500">Elapsed</dt>
            <dd className="font-medium">{elapsed != null ? `${elapsed}s` : '—'}</dd>
            {importJob.source_refresh_date && (
              <>
                <dt className="text-gray-500">Refresh date</dt>
                <dd className="font-medium">{importJob.source_refresh_date}</dd>
              </>
            )}
            {importJob.error_log?.length && (
              <>
                <dt className="text-gray-500">Errors</dt>
                <dd className="text-red-600">{importJob.error_log.length} batch error(s)</dd>
              </>
            )}
          </dl>

          {importJob.status === 'completed' && (
            <p className="text-green-700 text-sm font-medium">
              Imported {importJob.parcel_count?.toLocaleString()} parcels for {importJob.county_name},{' '}
              {importJob.state}
              {importJob.source_refresh_date ? ` (refresh date ${importJob.source_refresh_date})` : ''}.
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={() => {
                setImportJob(null)
                setFile(null)
                setError(null)
              }}
              className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md"
            >
              Import another
            </button>
            <button
              onClick={() => navigate('/admin/parcels/counties')}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md"
            >
              View county library
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Drop zone */}
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              isDragActive ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
            }`}
          >
            <input {...getInputProps()} />
            {file ? (
              <p className="text-sm font-medium text-gray-700">{file.name}</p>
            ) : (
              <div>
                <p className="text-sm text-gray-500">
                  Drop a Shapefile (.zip), CSV, or GeoJSON here
                </p>
                <p className="text-xs text-gray-400 mt-1">or click to browse</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                County FIPS <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={countyFips}
                onChange={(e) => setCountyFips(e.target.value.replace(/\D/g, '').slice(0, 5))}
                placeholder="49035"
                className="w-full border rounded-md px-3 py-2 text-sm"
                maxLength={5}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                State <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={state}
                onChange={(e) => setState(e.target.value.replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase())}
                placeholder="UT"
                className="w-full border rounded-md px-3 py-2 text-sm"
                maxLength={2}
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              County Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={countyName}
              onChange={(e) => setCountyName(e.target.value)}
              placeholder="Salt Lake County"
              className="w-full border rounded-md px-3 py-2 text-sm"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Source Refresh Date</label>
            <input
              type="date"
              value={refreshDate}
              onChange={(e) => setRefreshDate(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
            <p className="text-xs text-gray-400 mt-1">
              Date Regrid refreshed this county's data (from the filename or Regrid Data Store)
            </p>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !file}
            className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-md text-sm"
          >
            {submitting ? 'Uploading…' : 'Start Import'}
          </button>
        </form>
      )}
    </div>
  )
}
