import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useClient } from '../context/ClientContext'
import { apiFetch } from '../lib/api'
import Navbar from '../components/ui/Navbar'
import UploadDropzone from '../components/upload/UploadDropzone'
import SheetMappingStep from '../components/upload/SheetMappingStep'
import ColumnMappingStep from '../components/upload/ColumnMappingStep'
import ValidateStep from '../components/upload/ValidateStep'
import ConfirmStep from '../components/upload/ConfirmStep'
import type {
  Account, Client, ServiceOffering, ClientTemplate, CustomFieldDefinition,
  SheetMeta, SheetMapping, BatchStatusResponse,
} from '../types'

type WizardStep = 'client' | 'upload' | 'sheet-mapping' | 'column-mapping' | 'validate' | 'confirm'

const STEP_LABELS: WizardStep[] = ['client', 'upload', 'sheet-mapping', 'column-mapping', 'validate', 'confirm']
const STEP_DISPLAY: Record<WizardStep, string> = {
  client: 'Account & Client',
  upload: 'Upload File',
  'sheet-mapping': 'Sheet Mapping',
  'column-mapping': 'Column Mapping',
  validate: 'Validate',
  confirm: 'Confirm',
}

function guessColumnMapping(columns: string[], templateMapping?: Record<string, { target: string }>): Record<string, string> {
  const result: Record<string, string> = {}
  const lower = (s: string) => s.toLowerCase()

  const patterns: Array<[RegExp, string]> = [
    [/^address.?line.?1$|^address1$|^addr1$|^street.?address$|^street$/i, 'address_line1'],
    [/^address.?line.?2$|^address2$|^addr2$/i, 'address_line2'],
    [/^city$|^city.?name$/i, 'city'],
    [/^state$|^state.?code$|^province$/i, 'state'],
    [/^postal.?code$|^zip$|^zipcode$|^postcode$/i, 'postal_code'],
    [/^country$|^country.?code$/i, 'country'],
    [/^property.?name$|^location.?name$|^name$/i, 'property_name'],
    [/^suite$|^floor$|^unit$/i, 'suite_or_floor'],
    [/^sqft$|^sq.?ft$|^square.?feet$|^serviceable.?sqft$/i, 'serviceable_sqft'],
    [/^location.?code$|^loc.?code$|^identifier$|^prop.?code$/i, 'identifier'],
    [/^frequency$|^freq$|^service.?frequency$|^visit.?freq$/i, 'frequency_notes'],
  ]

  for (const col of columns) {
    // Check template first
    if (templateMapping?.[col]?.target) {
      result[col] = templateMapping[col].target
      continue
    }
    // Pattern match
    for (const [pat, target] of patterns) {
      if (pat.test(col)) {
        result[col] = target
        break
      }
    }
    // Default: empty (skip)
    if (!result[col]) result[col] = ''
  }
  return result
}

export default function UploadPage() {
  const { getToken } = useAuth()
  const { clients, selectedClientId } = useClient()

  const [step, setStep] = useState<WizardStep>('client')
  const [error, setError] = useState<string | null>(null)

  // Step 0: account/client
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [selectedClientIdLocal, setSelectedClientIdLocal] = useState(selectedClientId ?? '')
  const [accountClients, setAccountClients] = useState<Client[]>([])
  const [loadingClients, setLoadingClients] = useState(false)
  const [clientsError, setClientsError] = useState<string | null>(null)
  const [clientTemplate, setClientTemplate] = useState<ClientTemplate | null>(null)

  // Step 1: file upload
  const [uploading, setUploading] = useState(false)
  const [batchId, setBatchId] = useState<string | null>(null)
  const [sheets, setSheets] = useState<SheetMeta[]>([])
  const [detectedFormat, setDetectedFormat] = useState('')

  // Step 2: sheet → offering mapping
  const [serviceOfferings, setServiceOfferings] = useState<ServiceOffering[]>([])
  const [sheetMappings, setSheetMappings] = useState<SheetMapping[]>([])

  // Step 3: column mapping
  const [columnMappings, setColumnMappings] = useState<Record<string, Record<string, string>>>({})
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([])
  const [saveToTemplate, setSaveToTemplate] = useState(false)

  // Step 4: validation
  const [batchStatus, setBatchStatus] = useState<BatchStatusResponse | null>(null)
  const [processing, setProcessing] = useState(false)

  // Load accounts
  useEffect(() => {
    getToken().then((token) => {
      if (!token) return
      fetch('/api/v1/accounts?status=active', { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.ok ? r.json() : [])
        .then(setAccounts)
        .catch(() => {})
    })
  }, [getToken])

  // Load clients for selected account
  useEffect(() => {
    if (!selectedAccountId) { setAccountClients([]); return }
    let cancelled = false
    setLoadingClients(true)
    setClientsError(null)
    getToken().then(async (token) => {
      try {
        const res = await fetch(`/api/v1/accounts/${selectedAccountId}/clients`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('Failed to load clients')
        if (!cancelled) {
          const data: Client[] = await res.json()
          setAccountClients(data)
          const acct = accounts.find((a) => a.id === selectedAccountId)
          if (acct?.account_type === 'self_managed' && data.length === 1) {
            setSelectedClientIdLocal(data[0].id)
          } else {
            setSelectedClientIdLocal('')
          }
        }
      } catch (err) {
        if (!cancelled) setClientsError(err instanceof Error ? err.message : 'Error')
      } finally {
        if (!cancelled) setLoadingClients(false)
      }
    })
    return () => { cancelled = true }
  }, [selectedAccountId, accounts, getToken])

  // Load client template when client changes
  const loadClientTemplate = useCallback(async (cid: string) => {
    if (!cid) return
    try {
      const token = await getToken()
      const res = await apiFetch(`/api/v1/clients/${cid}/template`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) setClientTemplate(await res.json())
    } catch { /* no template */ }
  }, [getToken])

  // Load service offerings for account/client
  const loadServiceOfferings = useCallback(async (accountId: string, clientId: string) => {
    try {
      const token = await getToken()
      const params = new URLSearchParams({ include_related: 'true' })
      if (accountId) params.set('account_id', accountId)
      if (clientId) params.set('client_id', clientId)
      const res = await apiFetch(`/api/v1/service-offerings?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) setServiceOfferings(await res.json())
    } catch { /* ignore */ }
  }, [getToken])

  // Load custom fields
  const loadCustomFields = useCallback(async (accountId: string, clientId: string) => {
    try {
      const token = await getToken()
      const params = new URLSearchParams()
      if (accountId) params.set('account_id', accountId)
      if (clientId) params.set('client_id', clientId)
      const res = await apiFetch(`/api/v1/custom-field-definitions?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) setCustomFields(await res.json())
    } catch { /* ignore */ }
  }, [getToken])

  const handleClientConfirmed = async () => {
    setError(null)
    const results = await Promise.allSettled([
      loadClientTemplate(selectedClientIdLocal),
      loadServiceOfferings(selectedAccountId, selectedClientIdLocal),
      loadCustomFields(selectedAccountId, selectedClientIdLocal),
    ])
    results.forEach((r) => {
      if (r.status === 'rejected') console.error('Preload failed:', r.reason)
    })
    setStep('upload')
  }

  const handleFile = async (file: File) => {
    setError(null)
    setUploading(true)

    if (file.size > 25 * 1024 * 1024) {
      setError('File too large. Maximum size is 25 MB.')
      setUploading(false)
      return
    }

    try {
      const token = await getToken()
      const form = new FormData()
      form.append('file', file)
      form.append('account_id', selectedAccountId)
      form.append('client_id', selectedClientIdLocal)

      const res = await fetch('/api/uploads', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: 'Upload failed' }))
        throw new Error(json.error ?? 'Upload failed')
      }

      const data = await res.json()
      setBatchId(data.batch_id)
      setSheets(data.sheets ?? [])
      setDetectedFormat(data.detected_format ?? '')

      // Initialize sheet mappings from template or blank
      const templateSheetMap = clientTemplate?.sheet_to_offering_mapping ?? {}
      setSheetMappings(
        (data.sheets as SheetMeta[]).map((sh) => ({
          sheet_name: sh.name,
          service_offering_id: (templateSheetMap[sh.name] as string | undefined) ?? null,
          skip: false,
        }))
      )

      // Initialize column mappings from template or guess
      const templateColMap = clientTemplate?.upload_column_mapping ?? {}
      const initColMappings: Record<string, Record<string, string>> = {}
      for (const sh of data.sheets as SheetMeta[]) {
        initColMappings[sh.name] = guessColumnMapping(sh.columns, templateColMap as Record<string, { target: string }>)
      }
      setColumnMappings(initColMappings)

      // Default save-to-template on if any new mappings
      setSaveToTemplate(true)

      setStep('sheet-mapping')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleProcessUpload = async () => {
    if (!batchId) return
    setProcessing(true)
    setError(null)
    setBatchStatus(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/uploads/${batchId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          sheet_mappings: sheetMappings,
          column_mappings: columnMappings,
          save_to_template: saveToTemplate,
          client_id: selectedClientIdLocal,
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: 'Failed' }))
        throw new Error(json.error ?? 'Failed to start processing')
      }
      const data = await res.json()
      setBatchStatus({
        batch_id: data.batch_id,
        status: 'processing',
        total_rows: data.total_rows ?? sheets.reduce((s, sh) => s + sh.row_count, 0),
        rows_processed: 0,
      } as BatchStatusResponse)
      setStep('validate')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start processing')
    } finally {
      setProcessing(false)
    }
  }

  const selectedClient =
    accountClients.find((c) => c.id === selectedClientIdLocal) ??
    clients.find((c) => c.id === selectedClientIdLocal)

  const stepIndex = STEP_LABELS.indexOf(step)

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <Navbar />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">Upload Service Locations</h1>

          {/* Step indicator */}
          <div className="flex items-center gap-1 mb-8 overflow-x-auto pb-1">
            {STEP_LABELS.map((s, i) => (
              <div key={s} className="flex items-center gap-1 shrink-0">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0
                    ${step === s ? 'bg-blue-600 text-white' : i < stepIndex ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-400'}`}
                >
                  {i < stepIndex ? '✓' : i + 1}
                </div>
                <span className={`text-xs whitespace-nowrap ${step === s ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>
                  {STEP_DISPLAY[s]}
                </span>
                {i < STEP_LABELS.length - 1 && <div className="w-6 h-px bg-gray-200 mx-1" />}
              </div>
            ))}
          </div>

          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* ── Step 0: Account & Client ─── */}
          {step === 'client' && (
            <div className="bg-white rounded-xl p-6 shadow-sm border space-y-5">
              <h2 className="font-semibold text-gray-800">Select Account &amp; Client</h2>
              <p className="text-sm text-gray-500">
                Uploaded data will be scoped to the selected account and client.
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account</label>
                {accounts.length === 0 ? (
                  <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                    No active accounts.{' '}
                    <Link to="/accounts/new" className="underline font-medium">Create one →</Link>
                  </div>
                ) : (
                  <select
                    value={selectedAccountId}
                    onChange={(e) => setSelectedAccountId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">— select account —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.display_name ?? a.name}</option>
                    ))}
                  </select>
                )}
                <Link to="/accounts/new" className="text-xs text-blue-600 hover:underline mt-1 inline-block">
                  + New Account
                </Link>
              </div>

              {selectedAccountId && (() => {
                const acct = accounts.find((a) => a.id === selectedAccountId)
                if (!acct || loadingClients) {
                  return loadingClients ? <div className="text-sm text-gray-400">Loading…</div> : null
                }
                if (clientsError) {
                  return <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{clientsError}</div>
                }
                if (acct.account_type === 'self_managed') {
                  const selfClient = accountClients[0]
                  return selfClient ? (
                    <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
                      Client: <strong>{selfClient.display_name ?? selfClient.name}</strong> (auto-resolved)
                    </div>
                  ) : (
                    <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                      No clients yet.{' '}
                      <Link to={`/accounts/${selectedAccountId}/clients/new`} className="underline font-medium">+ Add Client</Link>
                    </div>
                  )
                }
                return (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Client</label>
                    {accountClients.length === 0 ? (
                      <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                        No clients yet.{' '}
                        <Link to={`/accounts/${selectedAccountId}/clients/new`} className="underline font-medium">+ Add Client</Link>
                      </div>
                    ) : (
                      <>
                        <select
                          value={selectedClientIdLocal}
                          onChange={(e) => setSelectedClientIdLocal(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">— select client —</option>
                          {accountClients.map((c) => (
                            <option key={c.id} value={c.id}>{c.display_name ?? c.name}</option>
                          ))}
                        </select>
                        <Link to={`/accounts/${selectedAccountId}/clients/new`} className="text-xs text-blue-600 hover:underline mt-1 inline-block">
                          + New Client
                        </Link>
                      </>
                    )}
                  </div>
                )
              })()}

              <div className="flex justify-end pt-2">
                <button
                  onClick={handleClientConfirmed}
                  disabled={!selectedClientIdLocal}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next: Upload File
                </button>
              </div>
            </div>
          )}

          {/* ── Step 1: File Upload ─── */}
          {step === 'upload' && (
            <div className="bg-white rounded-xl p-6 shadow-sm border space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-800">Upload File</h2>
                {selectedClient && (
                  <span className="text-sm text-gray-500">
                    Client: <strong>{selectedClient.display_name ?? selectedClient.name}</strong>
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500">
                Upload a multi-sheet XLSX, XLS, or CSV file. Max 25 MB.
              </p>

              <UploadDropzone onFile={handleFile} loading={uploading} />

              {uploading && (
                <div className="flex items-center gap-3 text-sm text-gray-600">
                  <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  Uploading and parsing…
                </div>
              )}

              <div className="flex justify-between">
                <button
                  onClick={() => setStep('client')}
                  disabled={uploading}
                  className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40"
                >
                  Back
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Sheet → Service Offering Mapping ─── */}
          {step === 'sheet-mapping' && (
            <SheetMappingStep
              sheets={sheets}
              mappings={sheetMappings}
              serviceOfferings={serviceOfferings}
              clientTemplate={clientTemplate}
              clientName={selectedClient?.display_name ?? selectedClient?.name ?? 'this client'}
              accountId={selectedAccountId}
              clientId={selectedClientIdLocal}
              onMappingsChange={setSheetMappings}
              onServiceOfferingCreated={(so) => setServiceOfferings((prev) => [...prev, so])}
              onBack={() => setStep('upload')}
              onNext={() => setStep('column-mapping')}
              getToken={getToken}
            />
          )}

          {/* ── Step 3: Column Mapping ─── */}
          {step === 'column-mapping' && (
            <ColumnMappingStep
              sheets={sheets}
              sheetMappings={sheetMappings}
              columnMappings={columnMappings}
              customFields={customFields}
              clientTemplate={clientTemplate}
              accountId={selectedAccountId}
              clientId={selectedClientIdLocal}
              saveToTemplate={saveToTemplate}
              onColumnMappingsChange={setColumnMappings}
              onCustomFieldCreated={(cf) => setCustomFields((prev) => [...prev, cf])}
              onSaveToTemplateChange={setSaveToTemplate}
              onBack={() => setStep('sheet-mapping')}
              onNext={handleProcessUpload}
              getToken={getToken}
            />
          )}

          {/* ── Step 4: Validate ─── */}
          {step === 'validate' && batchId && (
            <ValidateStep
              batchId={batchId}
              batchStatus={batchStatus}
              onStatusUpdate={setBatchStatus}
              onBack={() => setStep('column-mapping')}
              onNext={() => setStep('confirm')}
              getToken={getToken}
            />
          )}

          {/* ── Step 5: Confirm & Import ─── */}
          {step === 'confirm' && batchId && batchStatus?.summary_stats && (
            <ConfirmStep
              batchId={batchId}
              stats={batchStatus.summary_stats}
              onCancelled={() => {
                setBatchId(null)
                setSheets([])
                setSheetMappings([])
                setColumnMappings({})
                setBatchStatus(null)
                setStep('upload')
              }}
              onBack={() => setStep('validate')}
              getToken={getToken}
            />
          )}
        </div>
      </div>
    </div>
  )
}
