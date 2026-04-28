import { useState } from 'react'
import type { SheetMeta, SheetMapping, CustomFieldDefinition, ClientTemplate } from '../../types'

interface Props {
  sheets: SheetMeta[]
  sheetMappings: SheetMapping[]
  columnMappings: Record<string, Record<string, string>>
  customFields: CustomFieldDefinition[]
  clientTemplate: ClientTemplate | null
  accountId: string
  clientId: string
  saveToTemplate: boolean
  onColumnMappingsChange: (mappings: Record<string, Record<string, string>>) => void
  onCustomFieldCreated: (field: CustomFieldDefinition) => void
  onSaveToTemplateChange: (val: boolean) => void
  onBack: () => void
  onNext: () => void
  getToken: () => Promise<string | null>
}

const ADDRESS_TARGETS = [
  { value: 'address_line1', label: 'Address Line 1', required: true },
  { value: 'address_line2', label: 'Address Line 2' },
  { value: 'city', label: 'City', required: true },
  { value: 'state', label: 'State / Province' },
  { value: 'postal_code', label: 'Postal Code' },
  { value: 'country', label: 'Country' },
]
const IDENTIFIER_TARGETS = [
  { value: 'property_name', label: 'Property Name' },
  { value: 'alternate_name', label: 'Alternate Name' },
  { value: 'identifier', label: 'Identifier / Location Code' },
  { value: 'suite_or_floor', label: 'Suite / Floor' },
]
const OPERATIONAL_TARGETS = [
  { value: 'serviceable_sqft', label: 'Serviceable Sq Ft' },
  { value: 'frequency_notes', label: 'Frequency Notes' },
]

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function isMappingValid(mappings: Record<string, string>): boolean {
  const targets = new Set(Object.values(mappings).filter((v) => v && v !== ''))
  if (!targets.has('address_line1') || !targets.has('city')) return false
  return (targets.has('state') && targets.has('postal_code')) || targets.has('country')
}

interface NewFieldForm {
  sheetName: string
  sourceCol: string
  label: string
  field_key: string
  field_type: 'text' | 'number' | 'date' | 'select'
  appears_in_filters: boolean
  appears_in_groups: boolean
  auto_populate: boolean
  distinctValues: string[]
}

export default function ColumnMappingStep({
  sheets,
  sheetMappings,
  columnMappings,
  customFields,
  clientTemplate,
  accountId,
  clientId,
  saveToTemplate,
  onColumnMappingsChange,
  onCustomFieldCreated,
  onSaveToTemplateChange,
  onBack,
  onNext,
  getToken,
}: Props) {
  const [newFieldForm, setNewFieldForm] = useState<NewFieldForm | null>(null)
  const [creatingField, setCreatingField] = useState(false)
  const [createFieldError, setCreateFieldError] = useState<string | null>(null)

  const activeSheets = sheets.filter((s) => {
    const m = sheetMappings.find((sm) => sm.sheet_name === s.name)
    return m && !m.skip
  })

  const allValid = activeSheets.every((s) => isMappingValid(columnMappings[s.name] ?? {}))

  const updateSheetMapping = (sheetName: string, col: string, target: string) => {
    onColumnMappingsChange({
      ...columnMappings,
      [sheetName]: { ...(columnMappings[sheetName] ?? {}), [col]: target },
    })
  }

  const getMappedTargets = (sheetName: string) =>
    new Set(Object.values(columnMappings[sheetName] ?? {}).filter((v) => v && v !== ''))

  const getAutoMappedCount = (sheetName: string) => {
    if (!clientTemplate?.is_configured) return 0
    const sheetColMap = columnMappings[sheetName] ?? {}
    return Object.values(sheetColMap).filter((v) => v && v !== '').length
  }

  const openNewFieldForm = (sheetName: string, sourceCol: string) => {
    setNewFieldForm({
      sheetName,
      sourceCol,
      label: sourceCol,
      field_key: slugify(sourceCol),
      field_type: 'text',
      appears_in_filters: true,
      appears_in_groups: false,
      auto_populate: false,
      distinctValues: [],
    })
  }

  const handleCreateField = async () => {
    if (!newFieldForm || !newFieldForm.label.trim() || !newFieldForm.field_key.trim()) return
    setCreatingField(true)
    setCreateFieldError(null)
    try {
      const token = await getToken()
      const body: Record<string, unknown> = {
        field_key: newFieldForm.field_key,
        field_label: newFieldForm.label,
        field_type: newFieldForm.field_type,
        account_id: accountId,
        client_id: clientId,
        appears_in_filters: newFieldForm.appears_in_filters,
        appears_in_groups: newFieldForm.appears_in_groups,
      }
      const res = await fetch('/api/v1/custom-field-definitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: 'Failed' }))
        throw new Error(json.error ?? 'Failed to create field')
      }
      const field: CustomFieldDefinition = await res.json()
      onCustomFieldCreated(field)
      updateSheetMapping(newFieldForm.sheetName, newFieldForm.sourceCol, `custom:${field.field_key}`)
      setNewFieldForm(null)
    } catch (err) {
      setCreateFieldError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setCreatingField(false)
    }
  }

  return (
    <div className="space-y-6">
      {activeSheets.map((sheet) => {
        const sheetColMapping = columnMappings[sheet.name] ?? {}
        const mappedTargets = getMappedTargets(sheet.name)
        const valid = isMappingValid(sheetColMapping)
        const autoMappedCount = getAutoMappedCount(sheet.name)
        const totalCols = sheet.columns.length
        const mappedCount = Object.values(sheetColMapping).filter((v) => v && v !== '').length

        return (
          <div key={sheet.name} className="bg-white rounded-xl p-6 shadow-sm border">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-800">{sheet.name}</h2>
              <div className="flex items-center gap-3">
                {clientTemplate?.is_configured && autoMappedCount > 0 && (
                  <span className="text-xs text-blue-600">
                    {autoMappedCount} of {totalCols} auto-mapped from template
                  </span>
                )}
                <span className="text-xs text-gray-500">{mappedCount}/{totalCols} mapped</span>
              </div>
            </div>

            {!valid && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                Required: address_line1 + city + (state & postal_code, or country)
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {sheet.columns.map((col) => {
                const currentTarget = sheetColMapping[col] ?? ''
                const isRequired =
                  currentTarget &&
                  ['address_line1', 'city'].includes(currentTarget)

                return (
                  <div key={col} className="flex flex-col gap-1">
                    <label className={`text-xs font-medium truncate ${isRequired && !currentTarget ? 'text-red-600' : 'text-gray-600'}`}>
                      {col}
                    </label>
                    <select
                      value={currentTarget}
                      onChange={(e) => {
                        if (e.target.value === '__new_custom__') {
                          openNewFieldForm(sheet.name, col)
                        } else {
                          updateSheetMapping(sheet.name, col, e.target.value)
                        }
                      }}
                      className={`border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500
                        ${!currentTarget ? 'border-gray-200 text-gray-400' : 'border-gray-300 text-gray-800'}`}
                    >
                      <option value="">— skip —</option>
                      <optgroup label="Address">
                        {ADDRESS_TARGETS.map((t) => (
                          <option key={t.value} value={t.value} disabled={mappedTargets.has(t.value) && currentTarget !== t.value}>
                            {t.label}{t.required ? ' *' : ''}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Identifiers">
                        {IDENTIFIER_TARGETS.map((t) => (
                          <option key={t.value} value={t.value} disabled={mappedTargets.has(t.value) && currentTarget !== t.value}>
                            {t.label}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Operational">
                        {OPERATIONAL_TARGETS.map((t) => (
                          <option key={t.value} value={t.value} disabled={mappedTargets.has(t.value) && currentTarget !== t.value}>
                            {t.label}
                          </option>
                        ))}
                      </optgroup>
                      {customFields.length > 0 && (
                        <optgroup label="Custom Fields">
                          {customFields.map((cf) => (
                            <option key={cf.id} value={`custom:${cf.field_key}`}>
                              {cf.field_label}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="">
                        <option value="__new_custom__">+ New custom field…</option>
                      </optgroup>
                    </select>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      <div className="bg-white rounded-xl px-6 py-4 shadow-sm border">
        <label className="flex items-center gap-3 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={saveToTemplate}
            onChange={(e) => onSaveToTemplateChange(e.target.checked)}
            className="rounded"
          />
          Save these mappings to client&apos;s template
        </label>
      </div>

      {/* Inline create custom field modal */}
      {newFieldForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-semibold text-gray-900">New Custom Field</h3>
            <p className="text-xs text-gray-500">Source column: <strong>{newFieldForm.sourceCol}</strong></p>
            {createFieldError && (
              <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">{createFieldError}</div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Label <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={newFieldForm.label}
                onChange={(e) => setNewFieldForm({
                  ...newFieldForm,
                  label: e.target.value,
                  field_key: slugify(e.target.value),
                })}
                autoFocus
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Field Key</label>
              <input
                type="text"
                value={newFieldForm.field_key}
                onChange={(e) => setNewFieldForm({ ...newFieldForm, field_key: slugify(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                value={newFieldForm.field_type}
                onChange={(e) => setNewFieldForm({ ...newFieldForm, field_type: e.target.value as NewFieldForm['field_type'] })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
                <option value="select">Select</option>
              </select>
            </div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={newFieldForm.appears_in_filters}
                  onChange={(e) => setNewFieldForm({ ...newFieldForm, appears_in_filters: e.target.checked })}
                  className="rounded"
                />
                Filterable
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={newFieldForm.appears_in_groups}
                  onChange={(e) => setNewFieldForm({ ...newFieldForm, appears_in_groups: e.target.checked })}
                  className="rounded"
                />
                Groupable
              </label>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => { setNewFieldForm(null); setCreateFieldError(null) }}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateField}
                disabled={creatingField || !newFieldForm.label.trim() || !newFieldForm.field_key.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {creatingField ? 'Creating…' : 'Create & Map'}
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
          disabled={!allValid}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue to Validate
        </button>
      </div>
    </div>
  )
}
