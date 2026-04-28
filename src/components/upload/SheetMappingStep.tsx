import { useState } from 'react'
import type { SheetMeta, SheetMapping, ServiceOffering, ClientTemplate } from '../../types'
import type { PricingModel } from '../../types'

interface Props {
  sheets: SheetMeta[]
  mappings: SheetMapping[]
  serviceOfferings: ServiceOffering[]
  clientTemplate: ClientTemplate | null
  clientName: string
  accountId: string
  clientId: string
  onMappingsChange: (mappings: SheetMapping[]) => void
  onServiceOfferingCreated: (so: ServiceOffering) => void
  onBack: () => void
  onNext: () => void
  getToken: () => Promise<string | null>
}

interface NewOfferingForm {
  sheetName: string
  name: string
  pricing_model: PricingModel
  default_frequency_label: string
}

export default function SheetMappingStep({
  sheets,
  mappings,
  serviceOfferings,
  clientTemplate,
  clientName,
  accountId,
  clientId,
  onMappingsChange,
  onServiceOfferingCreated,
  onBack,
  onNext,
  getToken,
}: Props) {
  const [newOfferingForm, setNewOfferingForm] = useState<NewOfferingForm | null>(null)
  const [creatingOffering, setCreatingOffering] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const autoMapped = mappings.filter(
    (m) => !m.skip && m.service_offering_id && clientTemplate?.sheet_to_offering_mapping?.[m.sheet_name]
  ).length

  const needsAttention = mappings.filter(
    (m) => !m.skip && !m.service_offering_id
  ).length

  const canProceed = mappings.every((m) => m.skip || m.service_offering_id)

  const updateMapping = (sheetName: string, update: Partial<SheetMapping>) => {
    onMappingsChange(mappings.map((m) => (m.sheet_name === sheetName ? { ...m, ...update } : m)))
  }

  const handleCreateOffering = async () => {
    if (!newOfferingForm || !newOfferingForm.name.trim()) return
    setCreatingOffering(true)
    setCreateError(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/v1/service-offerings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: newOfferingForm.name.trim(),
          pricing_model: newOfferingForm.pricing_model,
          default_frequency_label: newOfferingForm.default_frequency_label || null,
          account_id: accountId || null,
          client_id: clientId || null,
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: 'Failed' }))
        throw new Error(json.error ?? 'Failed to create offering')
      }
      const so: ServiceOffering = await res.json()
      onServiceOfferingCreated(so)
      updateMapping(newOfferingForm.sheetName, { service_offering_id: so.id })
      setNewOfferingForm(null)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setCreatingOffering(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl p-6 shadow-sm border">
        <h2 className="font-semibold text-gray-800 mb-2">Map Sheets to Service Offerings</h2>

        {clientTemplate?.is_configured && autoMapped > 0 && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
            Detected {sheets.length} sheet{sheets.length !== 1 ? 's' : ''}.{' '}
            <strong>{autoMapped}</strong> auto-mapped from {clientName}&apos;s template.
            {needsAttention > 0 && (
              <> <strong>{needsAttention}</strong> need attention.</>
            )}
          </div>
        )}

        <div className="space-y-3">
          {sheets.map((sheet) => {
            const mapping = mappings.find((m) => m.sheet_name === sheet.name)!
            const isSkipped = mapping.skip

            return (
              <div
                key={sheet.name}
                className={`p-4 border rounded-lg ${isSkipped ? 'bg-gray-50 opacity-60' : 'bg-white'}`}
              >
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-gray-800 truncate">{sheet.name}</span>
                      <span className="text-xs text-gray-400">{sheet.row_count.toLocaleString()} rows</span>
                    </div>
                    <div className="text-xs text-gray-400 truncate">
                      Columns: {sheet.columns.slice(0, 5).join(', ')}
                      {sheet.columns.length > 5 && ` +${sheet.columns.length - 5} more`}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {!isSkipped && (
                      <div className="flex items-center gap-2">
                        <select
                          value={mapping.service_offering_id ?? ''}
                          onChange={(e) => {
                            if (e.target.value === '__new__') {
                              setNewOfferingForm({
                                sheetName: sheet.name,
                                name: '',
                                pricing_model: 'custom',
                                default_frequency_label: '',
                              })
                            } else {
                              updateMapping(sheet.name, { service_offering_id: e.target.value || null })
                            }
                          }}
                          className={`border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px]
                            ${!mapping.service_offering_id ? 'border-red-300 bg-red-50' : 'border-gray-300'}`}
                        >
                          <option value="">— select offering —</option>
                          {serviceOfferings.map((so) => (
                            <option key={so.id} value={so.id}>
                              {so.display_name ?? so.name}
                            </option>
                          ))}
                          <option value="__new__">+ Create new offering</option>
                        </select>
                      </div>
                    )}

                    <label className="flex items-center gap-2 text-sm text-gray-600 whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={isSkipped}
                        onChange={(e) => updateMapping(sheet.name, { skip: e.target.checked, service_offering_id: e.target.checked ? null : mapping.service_offering_id })}
                        className="rounded"
                      />
                      Skip this sheet
                    </label>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Inline create offering modal */}
      {newOfferingForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-semibold text-gray-900">Create New Service Offering</h3>
            {createError && (
              <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">{createError}</div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={newOfferingForm.name}
                onChange={(e) => setNewOfferingForm({ ...newOfferingForm, name: e.target.value })}
                placeholder="e.g. Lawn Care"
                autoFocus
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Pricing Model</label>
              <select
                value={newOfferingForm.pricing_model}
                onChange={(e) => setNewOfferingForm({ ...newOfferingForm, pricing_model: e.target.value as PricingModel })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="custom">Custom</option>
                <option value="fixed_per_visit">Fixed per Visit</option>
                <option value="monthly_recurring">Monthly Recurring</option>
                <option value="hourly">Hourly</option>
                <option value="per_sqft">Per Sq Ft</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Default Frequency Label</label>
              <input
                type="text"
                value={newOfferingForm.default_frequency_label}
                onChange={(e) => setNewOfferingForm({ ...newOfferingForm, default_frequency_label: e.target.value })}
                placeholder="e.g. Weekly, Monthly"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => { setNewOfferingForm(null); setCreateError(null) }}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateOffering}
                disabled={creatingOffering || !newOfferingForm.name.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {creatingOffering ? 'Creating…' : 'Create & Select'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!canProceed}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue to Column Mapping
        </button>
      </div>
    </div>
  )
}
