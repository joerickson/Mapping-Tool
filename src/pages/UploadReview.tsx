import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import Navbar from '../components/ui/Navbar'
import Button from '../components/ui/Button'
import type { StagedAddress, ScrubSummary, ValidatedAddress } from '../types'

type Tab = 'clean' | 'auto_corrected' | 'needs_review' | 'duplicates'

interface ReviewState {
  summary: ScrubSummary
  rows: StagedAddress[]
}

function AddressDisplay({ addr }: { addr: ValidatedAddress }) {
  return (
    <span>
      {addr.address_line1}
      {addr.address_line2 ? ` ${addr.address_line2}` : ''},{' '}
      {addr.city}, {addr.state} {addr.postal_code}
    </span>
  )
}

function DiffLine({ correction }: { correction: { field: string; original: string; corrected: string; reason: string } }) {
  return (
    <div className="text-xs mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
      <span className="font-medium text-gray-500 capitalize">{correction.field.replace('_', ' ')}:</span>
      <span className="line-through text-red-500">{correction.original}</span>
      <span className="text-green-600">→ {correction.corrected}</span>
      <span className="text-gray-400 italic">({correction.reason})</span>
    </div>
  )
}

function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  if (confidence == null) return null
  const pct = Math.round(confidence * 100)
  const color = pct >= 80 ? 'text-green-600 bg-green-50' : pct >= 50 ? 'text-yellow-700 bg-yellow-50' : 'text-red-600 bg-red-50'
  return <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${color}`}>{pct}%</span>
}

export default function UploadReview() {
  const { batchId } = useParams<{ batchId: string }>()
  const { getToken } = useAuth()
  const navigate = useNavigate()

  const [state, setState] = useState<ReviewState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('clean')
  const [proceeding, setProceeding] = useState(false)
  const [editingRow, setEditingRow] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Partial<ValidatedAddress>>({})
  const [saving, setSaving] = useState(false)
  const [revertedRows, setRevertedRows] = useState<Set<string>>(new Set())

  const fetchReview = useCallback(async () => {
    if (!batchId) return
    try {
      setLoading(true)
      const token = await getToken()
      const res = await fetch(`/api/scrub/${batchId}/review`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setState(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load review data')
    } finally {
      setLoading(false)
    }
  }, [batchId, getToken])

  useEffect(() => { fetchReview() }, [fetchReview])

  const patchRow = async (rowId: string, body: Record<string, unknown>) => {
    const token = await getToken()
    const res = await fetch(`/api/scrub/${batchId}/rows/${rowId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(await res.text())
    await fetchReview()
  }

  const handleSkip = async (rowId: string) => {
    await patchRow(rowId, { user_action: 'skip' })
  }

  const handleRevert = async (row: StagedAddress) => {
    if (!row.validated_address) return
    // Reconstruct pre-correction address by applying original values from corrections
    const preCorrection: ValidatedAddress = { ...row.validated_address }
    for (const c of row.scrub_corrections ?? []) {
      if (c.field in preCorrection) {
        (preCorrection as Record<string, string>)[c.field] = c.original
      }
    }
    await patchRow(row.staged_id, { user_action: 'approved', user_edited_address: preCorrection })
    setRevertedRows((prev) => new Set(prev).add(row.staged_id))
  }

  const handleEditSave = async (rowId: string) => {
    setSaving(true)
    try {
      await patchRow(rowId, { user_edited_address: editValues, user_action: 'approved' })
      setEditingRow(null)
      setEditValues({})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleApproveAll = async (status: string) => {
    if (!state) return
    const rows = state.rows.filter((r) => r.scrub_status === status && !r.user_action)
    for (const row of rows) {
      await patchRow(row.staged_id, { user_action: 'approved' })
    }
  }

  const handleProceed = async () => {
    if (!batchId) return
    setProceeding(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/scrub/${batchId}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(await res.text())
      const { jobId } = await res.json()
      navigate(`/map?job=${jobId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start enrichment')
    } finally {
      setProceeding(false)
    }
  }

  const unresolvedNeedsReview = state?.rows.filter(
    (r) => r.scrub_status === 'needs_review' && !r.user_action,
  ).length ?? 0

  const canProceed = unresolvedNeedsReview === 0 && !loading && !!state

  const GEOCODE_COST = 0.005
  const SMARTY_COST = 0.001
  const processableCount = state
    ? state.rows.filter((r) =>
        ['clean', 'auto_corrected'].includes(r.scrub_status) ||
        (r.scrub_status === 'needs_review' && r.user_action === 'approved'),
      ).length
    : 0
  const estimatedGeo = (processableCount * GEOCODE_COST).toFixed(2)
  const smartyEnabled = state?.rows.some((r) => r.usps_verified != null)
  const estimatedSmarty = smartyEnabled ? (processableCount * SMARTY_COST).toFixed(2) : null

  if (loading) {
    return (
      <div className="flex flex-col h-full bg-gray-50">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-500">Loading review data…</div>
        </div>
      </div>
    )
  }

  if (error && !state) {
    return (
      <div className="flex flex-col h-full bg-gray-50">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-red-600">{error}</div>
        </div>
      </div>
    )
  }

  const s = state!
  const cleanRows = s.rows.filter((r) => r.scrub_status === 'clean')
  const correctedRows = s.rows.filter((r) => r.scrub_status === 'auto_corrected')
  const reviewRows = s.rows.filter((r) => r.scrub_status === 'needs_review')
  const dupeRows = s.rows.filter((r) => r.scrub_status === 'duplicate' || r.scrub_status === 'existing_property')

  const tabs: { id: Tab; label: string; count: number; dot?: string }[] = [
    { id: 'clean', label: 'Clean', count: cleanRows.length },
    { id: 'auto_corrected', label: 'Auto-corrected', count: correctedRows.length, dot: correctedRows.length > 0 ? 'yellow' : undefined },
    { id: 'needs_review', label: 'Needs review', count: reviewRows.length, dot: unresolvedNeedsReview > 0 ? 'red' : undefined },
    { id: 'duplicates', label: 'Duplicates', count: dupeRows.length },
  ]

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <Navbar />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Address Review</h1>
          <p className="text-gray-500 mb-6 text-sm">
            Review and approve scrubbed addresses before starting geocoding enrichment.
          </p>

          {/* Summary card */}
          <div className="bg-white rounded-xl p-5 shadow-sm border mb-6">
            <div className="flex flex-wrap gap-6">
              <Stat label="Uploaded" value={s.summary.total} color="gray" />
              <Stat label="Clean" value={s.summary.clean} color="green" />
              <Stat label="Auto-corrected" value={s.summary.auto_corrected} color="yellow" />
              <Stat label="Needs review" value={s.summary.needs_review} color="red" />
              <Stat label="Duplicates" value={s.summary.duplicate + s.summary.existing_property} color="gray" />
            </div>
          </div>

          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Tabs */}
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden mb-6">
            <div className="flex border-b">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-colors
                    ${activeTab === tab.id
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                  {tab.label}
                  <span className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full text-xs font-semibold
                    ${tab.dot === 'red' ? 'bg-red-100 text-red-700' : tab.dot === 'yellow' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'}`}>
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            <div className="p-4">
              {/* Clean tab */}
              {activeTab === 'clean' && (
                <div>
                  {cleanRows.length > 0 && (
                    <div className="flex justify-end mb-3">
                      <Button variant="secondary" onClick={() => handleApproveAll('clean')}>
                        Approve all
                      </Button>
                    </div>
                  )}
                  {cleanRows.length === 0 ? (
                    <EmptyState message="No clean addresses." />
                  ) : (
                    <ul className="divide-y text-sm">
                      {cleanRows.map((row) => (
                        <li key={row.staged_id} className="py-2 flex items-center justify-between gap-4">
                          <span className="text-gray-800">
                            {row.validated_address ? <AddressDisplay addr={row.validated_address} /> : '—'}
                          </span>
                          <div className="flex items-center gap-2 shrink-0">
                            <ConfidenceBadge confidence={row.scrub_confidence} />
                            {row.usps_verified === true && (
                              <span className="text-xs text-green-600 bg-green-50 px-1.5 py-0.5 rounded">USPS ✓</span>
                            )}
                            {row.user_action === 'approved' && (
                              <span className="text-xs text-blue-600">Approved</span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Auto-corrected tab */}
              {activeTab === 'auto_corrected' && (
                <div>
                  {correctedRows.length > 0 && (
                    <div className="flex justify-end mb-3">
                      <Button variant="secondary" onClick={() => handleApproveAll('auto_corrected')}>
                        Approve all corrections
                      </Button>
                    </div>
                  )}
                  {correctedRows.length === 0 ? (
                    <EmptyState message="No auto-corrected addresses." />
                  ) : (
                    <ul className="divide-y text-sm">
                      {correctedRows.map((row) => {
                        const isReverted = revertedRows.has(row.staged_id)
                        const displayAddr = row.user_edited_address ?? row.validated_address
                        return (
                          <li key={row.staged_id} className="py-3">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="text-gray-800">
                                  {displayAddr ? <AddressDisplay addr={displayAddr} /> : '—'}
                                </div>
                                {!isReverted && (row.scrub_corrections ?? []).map((c, i) => (
                                  <DiffLine key={i} correction={c} />
                                ))}
                                {isReverted && (
                                  <div className="text-xs text-gray-400 mt-1 italic">Correction reverted</div>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <ConfidenceBadge confidence={row.scrub_confidence} />
                                {!isReverted && row.scrub_corrections?.length ? (
                                  <button
                                    onClick={() => handleRevert(row)}
                                    className="text-xs text-gray-500 hover:text-red-600 underline"
                                  >
                                    Revert
                                  </button>
                                ) : null}
                                {row.user_action === 'approved' && (
                                  <span className="text-xs text-blue-600">Approved</span>
                                )}
                              </div>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )}

              {/* Needs review tab */}
              {activeTab === 'needs_review' && (
                <div>
                  {reviewRows.length === 0 ? (
                    <EmptyState message="No addresses need review." />
                  ) : (
                    <ul className="divide-y text-sm">
                      {reviewRows.map((row) => {
                        const isEditing = editingRow === row.staged_id
                        const addr = row.validated_address ?? { address_line1: '', city: '', state: '', postal_code: '', country: 'US' }
                        const issues = row.scrub_issues ?? []
                        const isResolved = !!row.user_action
                        return (
                          <li key={row.staged_id} className={`py-3 ${isResolved ? 'opacity-60' : ''}`}>
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 min-w-0">
                                {isEditing ? (
                                  <div className="space-y-2">
                                    <div className="grid grid-cols-2 gap-2">
                                      <input
                                        className="border rounded px-2 py-1 text-xs col-span-2"
                                        placeholder="Address line 1"
                                        value={editValues.address_line1 ?? addr.address_line1}
                                        onChange={(e) => setEditValues((v) => ({ ...v, address_line1: e.target.value }))}
                                      />
                                      <input
                                        className="border rounded px-2 py-1 text-xs"
                                        placeholder="City"
                                        value={editValues.city ?? addr.city}
                                        onChange={(e) => setEditValues((v) => ({ ...v, city: e.target.value }))}
                                      />
                                      <input
                                        className="border rounded px-2 py-1 text-xs"
                                        placeholder="State"
                                        value={editValues.state ?? addr.state}
                                        onChange={(e) => setEditValues((v) => ({ ...v, state: e.target.value }))}
                                      />
                                      <input
                                        className="border rounded px-2 py-1 text-xs"
                                        placeholder="Postal code"
                                        value={editValues.postal_code ?? addr.postal_code}
                                        onChange={(e) => setEditValues((v) => ({ ...v, postal_code: e.target.value }))}
                                      />
                                      <input
                                        className="border rounded px-2 py-1 text-xs"
                                        placeholder="Country"
                                        value={editValues.country ?? addr.country}
                                        onChange={(e) => setEditValues((v) => ({ ...v, country: e.target.value }))}
                                      />
                                    </div>
                                    <div className="flex gap-2">
                                      <Button onClick={() => handleEditSave(row.staged_id)} loading={saving}>
                                        Save
                                      </Button>
                                      <Button variant="secondary" onClick={() => { setEditingRow(null); setEditValues({}) }}>
                                        Cancel
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <div className="text-gray-800">
                                      {row.validated_address
                                        ? <AddressDisplay addr={row.validated_address} />
                                        : <span className="text-gray-400 italic">Unparseable address</span>}
                                    </div>
                                    {issues.map((issue, i) => (
                                      <div key={i} className="text-xs text-red-600 mt-0.5">⚠ {issue}</div>
                                    ))}
                                    {isResolved && (
                                      <div className="text-xs text-gray-500 mt-1 capitalize">
                                        Action: {row.user_action}
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                              {!isEditing && !isResolved && (
                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    onClick={() => {
                                      setEditingRow(row.staged_id)
                                      setEditValues({})
                                    }}
                                    className="text-xs text-blue-600 hover:underline"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => handleSkip(row.staged_id)}
                                    className="text-xs text-gray-500 hover:text-red-600 hover:underline"
                                  >
                                    Skip
                                  </button>
                                </div>
                              )}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )}

              {/* Duplicates tab */}
              {activeTab === 'duplicates' && (
                <div>
                  {dupeRows.length === 0 ? (
                    <EmptyState message="No duplicates detected." />
                  ) : (
                    <ul className="divide-y text-sm">
                      {dupeRows.map((row) => (
                        <li key={row.staged_id} className="py-3">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="text-gray-800">
                                {row.validated_address ? <AddressDisplay addr={row.validated_address} /> : '—'}
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5">
                                {row.scrub_status === 'existing_property'
                                  ? `Matches existing property ${row.existing_property_id}`
                                  : 'Duplicate within this upload'}
                              </div>
                              {row.user_action && (
                                <div className="text-xs text-blue-600 mt-0.5 capitalize">Action: {row.user_action}</div>
                              )}
                            </div>
                            {!row.user_action && (
                              <div className="flex gap-2 shrink-0">
                                <button
                                  onClick={() => patchRow(row.staged_id, { user_action: 'skip' })}
                                  className="text-xs text-gray-500 hover:underline"
                                >
                                  Skip
                                </button>
                                {row.scrub_status === 'existing_property' ? (
                                  <button
                                    onClick={() => patchRow(row.staged_id, { user_action: 'merge' })}
                                    className="text-xs text-blue-600 hover:underline"
                                  >
                                    Merge
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => patchRow(row.staged_id, { user_action: 'treat_as_new' })}
                                    className="text-xs text-blue-600 hover:underline"
                                  >
                                    Treat as new
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Proceed footer */}
          <div className="bg-white rounded-xl p-5 shadow-sm border flex items-center justify-between gap-4">
            <div className="text-sm text-gray-600 space-y-0.5">
              <div>~{processableCount} addresses to geocode</div>
              <div className="text-gray-400 text-xs">
                Estimated geocoding cost: ~${estimatedGeo}
                {estimatedSmarty && ` · Smarty validation: ~$${estimatedSmarty}`}
              </div>
              {unresolvedNeedsReview > 0 && (
                <div className="text-red-600 text-xs font-medium">
                  {unresolvedNeedsReview} address{unresolvedNeedsReview > 1 ? 'es' : ''} still need review
                </div>
              )}
            </div>
            <Button onClick={handleProceed} disabled={!canProceed} loading={proceeding}>
              Proceed to enrichment
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: 'green' | 'yellow' | 'red' | 'gray' }) {
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

function EmptyState({ message }: { message: string }) {
  return <div className="py-8 text-center text-gray-400 text-sm">{message}</div>
}
