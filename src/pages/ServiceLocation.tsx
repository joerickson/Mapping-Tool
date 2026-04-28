import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import Navbar from '../components/ui/Navbar'
import Button from '../components/ui/Button'
import type { ServiceLocation, Property, PropertyChange } from '../types'
import { STATUS_LABELS, STATUS_COLORS } from '../lib/constants'

interface EditableField {
  label: string
  field: keyof Property | keyof ServiceLocation
  type?: 'text' | 'number'
  entity: 'property' | 'location'
}

const EDITABLE_PROPERTY_FIELDS: EditableField[] = [
  { label: 'Place Name', field: 'place_name', entity: 'property' },
  { label: 'Place Website', field: 'place_website', entity: 'property' },
  { label: 'Place Phone', field: 'place_phone', entity: 'property' },
  { label: 'Owner Name', field: 'owner_name', entity: 'property' },
  { label: 'Zoning Code', field: 'zoning_code', entity: 'property' },
]

export default function ServiceLocationPage() {
  const { serviceLocationId } = useParams<{ serviceLocationId: string }>()
  const navigate = useNavigate()
  const { getToken } = useAuth()

  const [location, setLocation] = useState<ServiceLocation | null>(null)
  const [property, setProperty] = useState<Property | null>(null)
  const [changes, setChanges] = useState<PropertyChange[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingField, setEditingField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [overrideCategory, setOverrideCategory] = useState('')
  const [winteamJobNumber, setWinteamJobNumber] = useState('')

  const crmBaseUrl = import.meta.env.VITE_RBM_CRM_BASE_URL

  useEffect(() => {
    async function load() {
      if (!serviceLocationId) return
      setLoading(true)
      try {
        const token = await getToken()
        const headers = { Authorization: `Bearer ${token}` }
        const [locRes, changesRes] = await Promise.all([
          fetch(`/api/v1/service-locations/${serviceLocationId}`, { headers }),
          fetch(`/api/v1/service-locations/${serviceLocationId}/changes`, { headers }),
        ])
        if (locRes.ok) {
          const data = await locRes.json()
          setLocation(data.service_location)
          setProperty(data.property)
          setWinteamJobNumber(data.service_location.winteam_job_number ?? '')
          setOverrideCategory(data.property?.rbm_category ?? '')
        }
        if (changesRes.ok) setChanges(await changesRes.json())
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [serviceLocationId, getToken])

  const saveField = async (field: string, value: string, entity: 'property' | 'location') => {
    setSaving(true)
    try {
      const token = await getToken()
      const id = entity === 'property' ? property?.property_id : serviceLocationId
      const endpoint = entity === 'property'
        ? `/api/v1/properties/${id}`
        : `/api/v1/service-locations/${id}`
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ [field]: value }),
      })
      if (res.ok) {
        const updated = await res.json()
        if (entity === 'property') setProperty(updated.property ?? updated)
        else setLocation(updated.service_location ?? updated)
        setEditingField(null)
      }
    } finally {
      setSaving(false)
    }
  }

  const saveCategoryOverride = async () => {
    await saveField('rbm_category', overrideCategory, 'property')
  }

  const saveWinteam = async () => {
    await saveField('winteam_job_number', winteamJobNumber, 'location')
  }

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-500">Loading...</div>
        </div>
      </div>
    )
  }

  if (!location || !property) {
    return (
      <div className="flex flex-col h-full">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-500">Location not found.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <Navbar />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <button
                onClick={() => navigate('/map')}
                className="text-sm text-blue-600 hover:underline mb-1 flex items-center gap-1"
              >
                ← Back to Map
              </button>
              <h1 className="text-2xl font-bold text-gray-900">
                {location.display_name ?? location.location_code ?? 'Service Location'}
              </h1>
              <p className="text-gray-500 mt-0.5">
                {property.address_line1}, {property.city}, {property.state}
              </p>
            </div>
            <div className="flex gap-3">
              {location.client_id && crmBaseUrl && (
                <a
                  href={`${crmBaseUrl}/clients/${location.client_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="secondary" size="sm">Open in CRM →</Button>
                </a>
              )}
              <span
                className="px-3 py-1.5 rounded-full text-sm font-medium text-white"
                style={{ backgroundColor: STATUS_COLORS[location.status] }}
              >
                {STATUS_LABELS[location.status]}
              </span>
            </div>
          </div>

          {/* Property block */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Property Information</h2>
            <div className="grid grid-cols-2 gap-x-8 gap-y-4">
              {/* Read-only enriched fields */}
              <Field label="Address" value={property.address_line1} />
              <Field label="City / State / Zip" value={`${property.city}, ${property.state} ${property.postal_code}`} />
              {property.building_sqft && <Field label="Building Sq Ft" value={property.building_sqft.toLocaleString()} />}
              {property.year_built && <Field label="Year Built" value={String(property.year_built)} />}
              {property.lot_sqft && <Field label="Lot Sq Ft" value={property.lot_sqft.toLocaleString()} />}
              {property.land_use_code && <Field label="Land Use" value={property.land_use_code} />}
              {property.parcel_id && <Field label="Parcel ID" value={property.parcel_id} />}

              {/* Editable fields */}
              {EDITABLE_PROPERTY_FIELDS.map(({ label, field }) => {
                const val = (property as unknown as Record<string, unknown>)[field as string]
                return (
                  <InlineEdit
                    key={field as string}
                    label={label}
                    value={String(val ?? '')}
                    editing={editingField === field}
                    editValue={editValue}
                    onEdit={() => { setEditingField(field as string); setEditValue(String(val ?? '')) }}
                    onEditValue={setEditValue}
                    onSave={() => saveField(field as string, editValue, 'property')}
                    onCancel={() => setEditingField(null)}
                    saving={saving}
                  />
                )
              })}
            </div>

            {/* Category override */}
            <div className="mt-4 pt-4 border-t">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    RBM Category
                    <span className="ml-1 text-xs text-gray-400">
                      (source: {property.rbm_category_source ?? 'none'},
                      confidence: {property.rbm_category_confidence != null ? `${Math.round(property.rbm_category_confidence * 100)}%` : 'n/a'})
                    </span>
                  </label>
                  <input
                    type="text"
                    value={overrideCategory}
                    onChange={(e) => setOverrideCategory(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <Button size="sm" onClick={saveCategoryOverride} loading={saving}>
                  Override
                </Button>
              </div>
            </div>
          </div>

          {/* Service locations under this property */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Service Locations at this Property</h2>
            <div className="space-y-3">
              <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">
                      {location.display_name ?? location.location_code ?? 'This Location'}
                    </p>
                    {location.suite_or_floor && (
                      <p className="text-sm text-gray-500">{location.suite_or_floor}</p>
                    )}
                  </div>
                  <div className="text-right">
                    {location.serviceable_sqft && (
                      <p className="text-sm text-gray-600">{location.serviceable_sqft.toLocaleString()} sqft</p>
                    )}
                  </div>
                </div>
                {/* WinTeam Job Number */}
                <div className="mt-3 flex items-center gap-3">
                  <label className="text-sm text-gray-600 shrink-0">WinTeam Job #:</label>
                  <input
                    type="text"
                    value={winteamJobNumber}
                    onChange={(e) => setWinteamJobNumber(e.target.value)}
                    className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="e.g. 123456"
                  />
                  <Button size="sm" variant="secondary" onClick={saveWinteam} loading={saving}>
                    Save
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Audit trail */}
          {changes.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Change History</h2>
              <div className="space-y-2">
                {changes.map((c) => (
                  <div key={c.change_id} className="flex items-start gap-3 text-sm">
                    <span className="text-gray-400 shrink-0">
                      {new Date(c.changed_at).toLocaleDateString()}
                    </span>
                    <span className="font-medium text-gray-700">{c.field_name}</span>
                    <span className="text-gray-500">
                      {c.old_value ?? '—'} → {c.new_value ?? '—'}
                    </span>
                    {c.changed_by && (
                      <span className="text-gray-400">(by {c.changed_by})</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-gray-900 mt-0.5">{value}</p>
    </div>
  )
}

function InlineEdit({
  label, value, editing, editValue, onEdit, onEditValue, onSave, onCancel, saving,
}: {
  label: string
  value: string
  editing: boolean
  editValue: string
  onEdit: () => void
  onEditValue: (v: string) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
}) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={editValue}
            onChange={(e) => onEditValue(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <Button size="sm" onClick={onSave} loading={saving}>Save</Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 group">
          <p className="text-gray-900">{value || <span className="text-gray-400 italic">Not set</span>}</p>
          <button
            onClick={onEdit}
            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-600 transition-opacity"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
