import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import AppShell from '../../components/layout/AppShell'
import Button from '../../components/ui/Button'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { apiFetch } from '../../lib/api'
import type { Client, ServiceOffering, CustomFieldDefinition, ClientTemplate, PricingModel, CustomFieldType } from '../../types'

type WizardStep = 1 | 2 | 3 | 4 | 5

const PRICING_LABELS: Record<PricingModel, string> = {
  fixed_per_visit: 'Fixed per visit',
  monthly_recurring: 'Monthly recurring',
  hourly: 'Hourly',
  per_sqft: 'Per sqft',
  custom: 'Custom',
}

const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  select: 'Select',
}

const ADDRESS_TARGETS = [
  { value: 'address_line1', label: 'Address Line 1' },
  { value: 'address_line2', label: 'Address Line 2' },
  { value: 'city', label: 'City' },
  { value: 'state', label: 'State' },
  { value: 'postal_code', label: 'Postal Code' },
  { value: 'country', label: 'Country' },
  { value: 'location_code', label: 'Location Code' },
  { value: 'display_name', label: 'Display Name' },
  { value: 'suite_or_floor', label: 'Suite / Floor' },
  { value: 'serviceable_sqft', label: 'Serviceable Sqft' },
]

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

export default function ClientSetupPage() {
  const { id } = useParams<{ id: string }>()
  const { getToken } = useAuth()
  const navigate = useNavigate()

  const [client, setClient] = useState<Client | null>(null)
  const [step, setStep] = useState<WizardStep>(1)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Step 1: Service Offerings
  const [offerings, setOfferings] = useState<ServiceOffering[]>([])
  const [newOffName, setNewOffName] = useState('')
  const [newOffModel, setNewOffModel] = useState<PricingModel>('custom')
  const [newOffFreqLabel, setNewOffFreqLabel] = useState('')
  const [newOffVisits, setNewOffVisits] = useState('')
  const [addingOff, setAddingOff] = useState(false)

  // Step 2: Custom Fields
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([])
  const [newFieldLabel, setNewFieldLabel] = useState('')
  const [newFieldKey, setNewFieldKey] = useState('')
  const [newFieldType, setNewFieldType] = useState<CustomFieldType>('text')
  const [newFieldOptions, setNewFieldOptions] = useState('')
  const [addingField, setAddingField] = useState(false)

  // Step 3: Upload Template
  const [template, setTemplate] = useState<ClientTemplate | null>(null)
  const [colMappingRows, setColMappingRows] = useState<{ src: string; target: string; required: boolean }[]>([])
  const [sheetMappingRows, setSheetMappingRows] = useState<{ pattern: string; offeringId: string }[]>([])
  const [defaultCountry, setDefaultCountry] = useState('')

  // Step 4: Sample file validation
  const [sampleFile, setSampleFile] = useState<File | null>(null)
  const [sampleMappedCols, setSampleMappedCols] = useState<string[]>([])
  const [sampleUnmappedCols, setSampleUnmappedCols] = useState<string[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const sampleInputRef = useRef<HTMLInputElement>(null)

  async function loadData() {
    setLoading(true)
    try {
      const token = await getToken()
      const headers = { Authorization: `Bearer ${token}` }
      const [clientResult, offeringsResult, fieldsResult, templateResult] = await Promise.allSettled([
        apiFetch(`/api/v1/clients/${id}`, { headers }),
        apiFetch(`/api/v1/service-offerings?client_id=${id}`, { headers }),
        apiFetch(`/api/v1/custom-field-definitions?client_id=${id}`, { headers }),
        apiFetch(`/api/v1/clients/${id}/template`, { headers }),
      ])
      if (clientResult.status === 'fulfilled' && clientResult.value.ok)
        setClient(await clientResult.value.json())
      if (offeringsResult.status === 'fulfilled' && offeringsResult.value.ok)
        setOfferings(await offeringsResult.value.json())
      if (fieldsResult.status === 'fulfilled' && fieldsResult.value.ok)
        setCustomFields(await fieldsResult.value.json())
      if (templateResult.status === 'fulfilled' && templateResult.value.ok) {
        const t: ClientTemplate = await templateResult.value.json()
        setTemplate(t)
        setDefaultCountry(t.default_country ?? '')
        setColMappingRows(
          Object.entries(t.upload_column_mapping ?? {}).map(([src, def]) => ({
            src,
            target: (def as { target: string }).target,
            required: (def as { required?: boolean }).required ?? false,
          }))
        )
        setSheetMappingRows(
          Object.entries(t.sheet_to_offering_mapping ?? {}).map(([pattern, offeringId]) => ({
            pattern,
            offeringId: offeringId as string,
          }))
        )
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (id) loadData() }, [id])

  // Auto-generate slug from label
  useEffect(() => {
    if (newFieldLabel && !newFieldKey) setNewFieldKey(slugify(newFieldLabel))
  }, [newFieldLabel])

  async function addOffering() {
    if (!newOffName.trim()) return
    setAddingOff(true)
    try {
      const token = await getToken()
      const res = await fetch('/api/v1/service-offerings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: newOffName.trim(),
          pricing_model: newOffModel,
          default_frequency_label: newOffFreqLabel.trim() || null,
          default_visits_per_year: newOffVisits ? parseFloat(newOffVisits) : null,
          client_id: id,
        }),
      })
      if (res.ok) {
        const newOffering = await res.json()
        setOfferings((prev) => [...prev, newOffering])
        setNewOffName(''); setNewOffFreqLabel(''); setNewOffVisits('')
      }
    } finally {
      setAddingOff(false)
    }
  }

  async function addCustomField() {
    if (!newFieldLabel.trim() || !newFieldKey.trim()) return
    setAddingField(true)
    try {
      const token = await getToken()
      const res = await fetch('/api/v1/custom-field-definitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          field_label: newFieldLabel.trim(),
          field_key: newFieldKey.trim(),
          field_type: newFieldType,
          select_options: newFieldType === 'select' && newFieldOptions
            ? newFieldOptions.split(',').map((s) => s.trim()).filter(Boolean)
            : null,
          client_id: id,
        }),
      })
      if (res.ok) {
        const newField = await res.json()
        setCustomFields((prev) => [...prev, newField])
        setNewFieldLabel(''); setNewFieldKey(''); setNewFieldOptions('')
      }
    } finally {
      setAddingField(false)
    }
  }

  async function saveTemplate(isConfigured = false) {
    const colMapping: Record<string, { target: string; required: boolean }> = {}
    for (const row of colMappingRows) {
      if (row.src && row.target) colMapping[row.src] = { target: row.target, required: row.required }
    }
    const sheetMapping: Record<string, string> = {}
    for (const row of sheetMappingRows) {
      if (row.pattern && row.offeringId) sheetMapping[row.pattern] = row.offeringId
    }
    const token = await getToken()
    await fetch(`/api/v1/clients/${id}/template`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        upload_column_mapping: colMapping,
        sheet_to_offering_mapping: sheetMapping,
        default_country: defaultCountry || null,
        is_configured: isConfigured,
      }),
    })
  }

  function parseSampleFile(file: File) {
    setSampleFile(file)
    setSampleMappedCols([])
    setSampleUnmappedCols([])
    const templateSrcCols = new Set(colMappingRows.map((r) => r.src.toLowerCase()))

    function processCols(cols: string[]) {
      const mapped: string[] = []
      const unmapped: string[] = []
      cols.forEach((c) => {
        if (templateSrcCols.has(c.toLowerCase())) mapped.push(c)
        else unmapped.push(c)
      })
      setSampleMappedCols(mapped)
      setSampleUnmappedCols(unmapped)
    }

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext === 'csv') {
      Papa.parse(file, {
        header: true,
        preview: 1,
        skipEmptyLines: true,
        complete: (results) => processCols(results.meta.fields ?? []),
      })
    } else {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target?.result, { type: 'binary' })
          const ws = wb.Sheets[wb.SheetNames[0]]
          const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
          processCols(rows.length ? Object.keys(rows[0]) : [])
        } catch { /* ignore parse errors */ }
      }
      reader.readAsBinaryString(file)
    }
  }

  async function goToStep(next: WizardStep) {
    setSaving(true)
    setError(null)
    try {
      if (step === 3) await saveTemplate(false)
      setStep(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function finish() {
    setSaving(true)
    try {
      await saveTemplate(true)
      navigate(`/clients/${id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete setup')
    } finally {
      setSaving(false)
    }
  }

  const STEP_LABELS = ['Service Offerings', 'Custom Fields', 'Upload Template', 'Validate Template', 'Done']

  if (loading) return (
    <AppShell>
      <div className="flex h-full items-center justify-center text-fg-subtle">Loading…</div>
    </AppShell>
  )

  const clientName = client?.display_name ?? client?.name ?? '…'

  return (
    <AppShell breadcrumb={[{ label: 'Clients', to: '/clients' }, { label: clientName, to: `/clients/${id}` }, { label: 'Setup' }]}>
      <div className="mx-auto max-w-3xl px-6 py-10 space-y-6">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Link to="/accounts" className="hover:text-gray-600">Accounts</Link>
            <span>›</span>
            <Link to={`/clients/${id}`} className="hover:text-gray-600">{clientName}</Link>
            <span>›</span>
            <span className="text-gray-700 font-medium">Setup</span>
          </div>

          <h1 className="text-2xl font-bold text-gray-900">Configure {clientName}</h1>

          {/* Step progress */}
          <div className="flex gap-1">
            {STEP_LABELS.map((label, i) => {
              const s = (i + 1) as WizardStep
              return (
                <div key={s} className="flex items-center gap-1 flex-1">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${step === s ? 'bg-blue-600 text-white' : s < step ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'}`}>{i + 1}</div>
                  <span className={`text-xs hidden sm:block ${step === s ? 'font-semibold text-gray-800' : 'text-gray-400'}`}>{label}</span>
                  {i < 4 && <div className="flex-1 h-0.5 bg-gray-200 mx-1" />}
                </div>
              )
            })}
          </div>

          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

          {/* ── Step 1: Service Offerings ── */}
          {step === 1 && (
            <div className="bg-white rounded-xl shadow-sm border p-6 space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">What services does {clientName} buy from us?</h2>
                <p className="text-sm text-gray-500 mt-1">Add at least one service offering to proceed.</p>
              </div>

              {offerings.length > 0 && (
                <ul className="divide-y border rounded-lg overflow-hidden">
                  {offerings.map((o) => (
                    <li key={o.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <span className="font-medium">{o.name}</span>
                      <span className="text-gray-400 text-xs">{PRICING_LABELS[o.pricing_model]}</span>
                    </li>
                  ))}
                </ul>
              )}

              {/* Add inline */}
              <div className="border rounded-lg p-4 space-y-3 bg-gray-50">
                <p className="text-sm font-medium text-gray-700">Add offering</p>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder="Name *"
                    value={newOffName}
                    onChange={(e) => setNewOffName(e.target.value)}
                    className="col-span-2 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <select
                    value={newOffModel}
                    onChange={(e) => setNewOffModel(e.target.value as PricingModel)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {(Object.keys(PRICING_LABELS) as PricingModel[]).map((m) => (
                      <option key={m} value={m}>{PRICING_LABELS[m]}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="Frequency label (e.g. Weekly)"
                    value={newOffFreqLabel}
                    onChange={(e) => setNewOffFreqLabel(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="number"
                    placeholder="Visits/year"
                    value={newOffVisits}
                    onChange={(e) => setNewOffVisits(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    min="0"
                    step="0.001"
                  />
                </div>
                <Button size="sm" loading={addingOff} onClick={addOffering} disabled={!newOffName.trim()}>
                  + Add Offering
                </Button>
              </div>

              <div className="flex justify-between pt-2">
                <Link to={`/clients/${id}`} className="text-sm text-gray-400 hover:text-gray-600 self-center">Cancel</Link>
                <Button onClick={() => goToStep(2)} loading={saving} disabled={offerings.length === 0}>
                  Continue →
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 2: Custom Fields ── */}
          {step === 2 && (
            <div className="bg-white rounded-xl shadow-sm border p-6 space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">What additional data does {clientName} track?</h2>
                <p className="text-sm text-gray-500 mt-1">Optional. Add custom fields for properties. Zero fields is fine.</p>
              </div>

              {customFields.length > 0 && (
                <ul className="divide-y border rounded-lg overflow-hidden">
                  {customFields.map((f) => (
                    <li key={f.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <span className="font-medium">{f.field_label}</span>
                      <span className="text-gray-400 text-xs font-mono">{f.field_key} · {f.field_type}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="border rounded-lg p-4 space-y-3 bg-gray-50">
                <p className="text-sm font-medium text-gray-700">Add field</p>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder="Label *"
                    value={newFieldLabel}
                    onChange={(e) => { setNewFieldLabel(e.target.value); setNewFieldKey(slugify(e.target.value)) }}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="text"
                    placeholder="Field key *"
                    value={newFieldKey}
                    onChange={(e) => setNewFieldKey(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <select
                    value={newFieldType}
                    onChange={(e) => setNewFieldType(e.target.value as CustomFieldType)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {(Object.keys(FIELD_TYPE_LABELS) as CustomFieldType[]).map((t) => (
                      <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                  {newFieldType === 'select' && (
                    <input
                      type="text"
                      placeholder="Options (comma-separated)"
                      value={newFieldOptions}
                      onChange={(e) => setNewFieldOptions(e.target.value)}
                      className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  )}
                </div>
                <Button size="sm" loading={addingField} onClick={addCustomField} disabled={!newFieldLabel.trim() || !newFieldKey.trim()}>
                  + Add Field
                </Button>
              </div>

              <div className="flex justify-between pt-2">
                <Button variant="secondary" onClick={() => setStep(1)}>← Back</Button>
                <Button onClick={() => goToStep(3)} loading={saving}>Continue →</Button>
              </div>
            </div>
          )}

          {/* ── Step 3: Upload Template ── */}
          {step === 3 && (
            <div className="bg-white rounded-xl shadow-sm border p-6 space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">How is {clientName}'s data structured?</h2>
                <p className="text-sm text-gray-500 mt-1">Map source column names to target fields. Optional but recommended.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Default Country</label>
                <select
                  value={defaultCountry}
                  onChange={(e) => setDefaultCountry(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">None (use file data)</option>
                  <option value="US">US</option>
                  <option value="CA">CA</option>
                  <option value="MX">MX</option>
                </select>
              </div>

              {/* Column mapping */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-gray-700">Column Mappings</p>
                  <button
                    onClick={() => setColMappingRows((prev) => [...prev, { src: '', target: '', required: false }])}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    + Add row
                  </button>
                </div>
                <div className="space-y-2">
                  {colMappingRows.map((row, i) => {
                    const customTargets = customFields.map((f) => ({ value: `custom:${f.field_key}`, label: `Custom: ${f.field_label}` }))
                    const allTargets = [...ADDRESS_TARGETS, ...customTargets]
                    return (
                      <div key={i} className="flex gap-2 items-center">
                        <input
                          type="text"
                          placeholder="Source column"
                          value={row.src}
                          onChange={(e) => setColMappingRows((prev) => prev.map((r, j) => j === i ? { ...r, src: e.target.value } : r))}
                          className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <select
                          value={row.target}
                          onChange={(e) => setColMappingRows((prev) => prev.map((r, j) => j === i ? { ...r, target: e.target.value } : r))}
                          className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">— target —</option>
                          {allTargets.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                        <label className="flex items-center gap-1 text-xs text-gray-600 shrink-0">
                          <input
                            type="checkbox"
                            checked={row.required}
                            onChange={(e) => setColMappingRows((prev) => prev.map((r, j) => j === i ? { ...r, required: e.target.checked } : r))}
                            className="rounded"
                          />
                          Req
                        </label>
                        <button
                          onClick={() => setColMappingRows((prev) => prev.filter((_, j) => j !== i))}
                          className="text-gray-300 hover:text-red-500 text-lg leading-none"
                        >
                          ×
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Sheet → offering mapping */}
              {offerings.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-gray-700">Sheet → Service Offering</p>
                    <button
                      onClick={() => setSheetMappingRows((prev) => [...prev, { pattern: '', offeringId: '' }])}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      + Add row
                    </button>
                  </div>
                  <div className="space-y-2">
                    {sheetMappingRows.map((row, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <input
                          type="text"
                          placeholder="Sheet name (or pattern with *)"
                          value={row.pattern}
                          onChange={(e) => setSheetMappingRows((prev) => prev.map((r, j) => j === i ? { ...r, pattern: e.target.value } : r))}
                          className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <select
                          value={row.offeringId}
                          onChange={(e) => setSheetMappingRows((prev) => prev.map((r, j) => j === i ? { ...r, offeringId: e.target.value } : r))}
                          className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">— offering —</option>
                          {offerings.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                        <button
                          onClick={() => setSheetMappingRows((prev) => prev.filter((_, j) => j !== i))}
                          className="text-gray-300 hover:text-red-500 text-lg leading-none"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-between pt-2">
                <Button variant="secondary" onClick={() => setStep(2)}>← Back</Button>
                <Button onClick={() => goToStep(4)} loading={saving}>Continue →</Button>
              </div>
            </div>
          )}

          {/* ── Step 4: Validate Template (optional) ── */}
          {step === 4 && (
            <div className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Validate Template (Optional)</h2>
                <p className="text-sm text-gray-500 mt-1">Drop a sample file to preview how the template maps to it. You can skip this step.</p>
              </div>

              <input
                ref={sampleInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) parseSampleFile(f) }}
              />

              {!sampleFile ? (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => sampleInputRef.current?.click()}
                  onKeyDown={(e) => e.key === 'Enter' && sampleInputRef.current?.click()}
                  onDragEnter={(e) => { e.preventDefault(); setIsDragging(true) }}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                  onDragLeave={(e) => { e.preventDefault(); setIsDragging(false) }}
                  onDrop={(e) => {
                    e.preventDefault()
                    setIsDragging(false)
                    const f = e.dataTransfer.files[0]
                    if (f) parseSampleFile(f)
                  }}
                  className={`flex items-center justify-center h-32 border-2 border-dashed rounded-xl cursor-pointer transition-colors text-sm select-none
                    ${isDragging
                      ? 'border-blue-400 bg-blue-50 text-blue-600'
                      : 'border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-500'
                    }`}
                >
                  {isDragging ? 'Drop file here' : 'Click or drag a sample file (.csv, .xlsx) — optional'}
                </div>
              ) : (
                <div className="border border-gray-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-700">{sampleFile.name}</p>
                    <button
                      onClick={() => { setSampleFile(null); setSampleMappedCols([]); setSampleUnmappedCols([]) }}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      ✕ Remove
                    </button>
                  </div>
                  {sampleMappedCols.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-green-700 mb-1">Auto-mapped ({sampleMappedCols.length})</p>
                      <div className="flex flex-wrap gap-1">
                        {sampleMappedCols.map((c) => (
                          <span key={c} className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">{c}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {sampleUnmappedCols.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 mb-1">Unmapped ({sampleUnmappedCols.length})</p>
                      <div className="flex flex-wrap gap-1">
                        {sampleUnmappedCols.map((c) => (
                          <span key={c} className="px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded-full">{c}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {sampleMappedCols.length === 0 && sampleUnmappedCols.length === 0 && (
                    <p className="text-sm text-gray-400">No columns detected — file may be empty.</p>
                  )}
                </div>
              )}

              <div className="flex justify-between pt-2">
                <Button variant="secondary" onClick={() => setStep(3)}>← Back</Button>
                <div className="flex gap-3">
                  <Button variant="secondary" onClick={() => setStep(5)}>Skip →</Button>
                  <Button onClick={() => setStep(5)}>Next →</Button>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 5: Done ── */}
          {step === 5 && (
            <div className="bg-white rounded-xl shadow-sm border p-6 space-y-5 text-center">
              <div className="flex justify-center">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">{clientName} is configured</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {offerings.length} service offering{offerings.length !== 1 ? 's' : ''} · {customFields.length} custom field{customFields.length !== 1 ? 's' : ''} · template {colMappingRows.filter((r) => r.src && r.target).length > 0 ? 'configured' : 'empty'}
                </p>
              </div>
              <div className="flex flex-col gap-3 items-center">
                <Button onClick={finish} loading={saving}>Complete Setup</Button>
                <Link to="/upload" className="text-sm text-blue-600 hover:underline">Upload first file →</Link>
              </div>
            </div>
          )}
      </div>
    </AppShell>
  )
}
