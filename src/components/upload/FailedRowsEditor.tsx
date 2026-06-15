import { useState } from 'react'

interface FailedRow {
  id: string
  sheet_name: string
  row_index: number
  property_data: Record<string, unknown>
  service_location_data: Record<string, unknown>
  service_offering_id: string | null
  reason: string | null
}

const PROP_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'address_line1', label: 'Address 1' },
  { key: 'address_line2', label: 'Address 2' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'postal_code', label: 'Postal' },
]
const SL_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'display_name', label: 'Name' },
  { key: 'suite_or_floor', label: 'Suite/Floor' },
  { key: 'serviceable_sqft', label: 'Sq Ft' },
]

export default function FailedRowsEditor({
  batchId,
  getToken,
  onRecommitted,
}: {
  batchId: string
  getToken: () => Promise<string | null>
  onRecommitted: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<FailedRow[] | null>(null)
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function loadRows() {
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/uploads/${batchId}/failed-rows`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'Failed to load rows')
      setRows(j.rows as FailedRow[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rows')
    } finally {
      setLoading(false)
    }
  }

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && rows === null) loadRows()
  }

  function editProp(id: string, key: string, value: string) {
    setRows((prev) =>
      prev?.map((r) => (r.id === id ? { ...r, property_data: { ...r.property_data, [key]: value } } : r)) ?? prev
    )
    setDirty((prev) => new Set(prev).add(id))
  }
  function editSl(id: string, key: string, value: string) {
    setRows((prev) =>
      prev?.map((r) =>
        r.id === id ? { ...r, service_location_data: { ...r.service_location_data, [key]: value } } : r
      ) ?? prev
    )
    setDirty((prev) => new Set(prev).add(id))
  }

  async function saveAndRecommit() {
    if (!rows) return
    setSaving(true)
    setError(null)
    setMsg(null)
    try {
      const token = await getToken()
      for (const r of rows) {
        if (!dirty.has(r.id)) continue
        const res = await fetch(`/api/uploads/${batchId}/update-row`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            row_id: r.id,
            property_data: r.property_data,
            service_location_data: r.service_location_data,
          }),
        })
        const j = await res.json()
        if (!res.ok) throw new Error(j.error ?? `Failed to save row ${r.row_index + 2}`)
      }
      const cres = await fetch(`/api/uploads/${batchId}/commit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const cj = await cres.json()
      if (!cres.ok) throw new Error(cj.error ?? 'Re-commit failed')
      setMsg(
        `Re-committed: ${cj.new_properties ?? 0} new properties, ${cj.new_service_locations ?? 0} new service locations, ${cj.failure_count ?? 0} still failing.`
      )
      setDirty(new Set())
      await loadRows()
      onRecommitted()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-2">
      <button type="button" onClick={toggle} className="text-xs font-medium text-amber-900 underline">
        {open ? 'Hide failed rows' : 'Review & fix failed rows'}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {loading && <p className="text-xs text-amber-800">Loading…</p>}
          {error && <p className="text-xs text-red-700">{error}</p>}
          {msg && <p className="text-xs font-medium text-green-700">{msg}</p>}

          {rows && rows.length === 0 && !loading && (
            <p className="text-xs text-amber-800">No pending failed rows — they may have all committed.</p>
          )}

          {rows && rows.length > 0 && (
            <>
              <div className="overflow-x-auto rounded-lg border border-amber-200 bg-white">
                <table className="min-w-full text-xs">
                  <thead className="bg-amber-100/50 text-left text-amber-900">
                    <tr>
                      {PROP_FIELDS.map((f) => (
                        <th key={f.key} className="px-2 py-1 font-medium">{f.label}</th>
                      ))}
                      {SL_FIELDS.map((f) => (
                        <th key={f.key} className="px-2 py-1 font-medium">{f.label}</th>
                      ))}
                      <th className="px-2 py-1 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-t border-amber-100">
                        {PROP_FIELDS.map((f) => (
                          <td key={f.key} className="px-1 py-1">
                            <input
                              className="w-28 rounded border border-gray-200 px-1 py-0.5"
                              value={String(r.property_data[f.key] ?? '')}
                              onChange={(e) => editProp(r.id, f.key, e.target.value)}
                            />
                          </td>
                        ))}
                        {SL_FIELDS.map((f) => (
                          <td key={f.key} className="px-1 py-1">
                            <input
                              className="w-24 rounded border border-gray-200 px-1 py-0.5"
                              value={String(r.service_location_data[f.key] ?? '')}
                              onChange={(e) => editSl(r.id, f.key, e.target.value)}
                            />
                          </td>
                        ))}
                        <td className="max-w-[16rem] truncate px-2 py-1 text-red-700" title={r.reason ?? ''}>
                          {r.reason ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                onClick={saveAndRecommit}
                disabled={saving || dirty.size === 0}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : `Save & re-commit${dirty.size ? ` (${dirty.size})` : ''}`}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
