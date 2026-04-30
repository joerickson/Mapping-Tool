// Editable-field whitelist — single source of truth for what users can edit
// on a property or service_location, what type each field is, and any
// special handling (address bundle, sqft threshold).
//
// Both the PATCH API (for validation + side-effect routing) and the
// PropertyDetail UI (for rendering inline editors) read this. Adding a new
// editable field = one entry here.

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'tags' // text[] rendered as a chip list
  | 'custom_fields' // arbitrary key/value jsonb editor

export interface FieldSpec {
  key: string
  label: string
  kind: FieldKind
  helper?: string
  options?: { value: string; label: string }[]
  // 'address': editing any of these triggers re-geocode in the API
  // 'sqft': editing this triggers a >10% threshold check that may flip
  //   crew_strategy to 'stale'
  group?: 'address' | 'sqft'
}

// Property-level editable fields. Order matters — UI renders in this order.
export const PROPERTY_FIELDS: FieldSpec[] = [
  { key: 'address_line1', label: 'Address line 1', kind: 'text', group: 'address' },
  { key: 'address_line2', label: 'Address line 2', kind: 'text', group: 'address' },
  { key: 'city',          label: 'City',           kind: 'text', group: 'address' },
  { key: 'state',         label: 'State',          kind: 'text', group: 'address' },
  { key: 'postal_code',   label: 'Postal code',    kind: 'text', group: 'address' },
  { key: 'country',       label: 'Country',        kind: 'text', group: 'address' },

  { key: 'rbm_category',    label: 'Category',     kind: 'text', helper: 'Property classification override' },
  { key: 'rbm_subcategory', label: 'Subcategory',  kind: 'text' },

  {
    key: 'notes',
    label: 'Notes',
    kind: 'textarea',
    helper: 'Internal notes — not shared with clients',
  },
  {
    key: 'internal_tags',
    label: 'Internal tags',
    kind: 'tags',
    helper: 'Add tags to group properties (e.g. "high-priority", "vip-account")',
  },
]

// service_location-level editable fields.
//
// Phase 4b expanded from 5 → 12 fields. service_schedule (jsonb) stays
// read-only — its rich editor is deferred to Phase 4f when the scheduler
// UI lands. monthly_direct_cost / crew_size / site_contact_* / access_notes
// would need new schema columns; deferred.
export const SERVICE_LOCATION_FIELDS: FieldSpec[] = [
  { key: 'display_name',    label: 'Display name',     kind: 'text' },
  { key: 'location_code',   label: 'Location code',    kind: 'text' },
  { key: 'suite_or_floor',  label: 'Suite / floor',    kind: 'text' },
  {
    key: 'serviceable_sqft',
    label: 'Serviceable sqft',
    kind: 'number',
    group: 'sqft',
    helper: 'Changes ≥10% mark Crew Strategy, Workforce Sizing, and Bid Pricing stale.',
  },
  {
    key: 'service_frequency',
    label: 'Service frequency',
    kind: 'text',
    helper: 'Free-form (e.g. "monthly", "quarterly", "Tu/Th").',
  },
  {
    key: 'visits_per_year_override',
    label: 'Visits per year (override)',
    kind: 'number',
    helper: 'Stales Crew Strategy + Bid Pricing.',
  },
  {
    key: 'hours_per_visit_override',
    label: 'Hours per visit (override)',
    kind: 'number',
    helper: 'Stales Crew Strategy + Bid Pricing.',
  },
  {
    key: 'crew_size_override',
    label: 'Crew size (override)',
    kind: 'number',
    helper: 'Stales Crew Strategy.',
  },
  {
    key: 'monthly_contract_value',
    label: 'Monthly contract value',
    kind: 'number',
    helper: 'Stales Bid Pricing.',
  },
  {
    key: 'frequency_notes',
    label: 'Frequency notes',
    kind: 'textarea',
  },
  {
    key: 'custom_fields',
    label: 'Custom fields',
    kind: 'custom_fields',
    helper: 'Arbitrary key/value pairs stored on this service location.',
  },
  {
    key: 'service_offering_id',
    label: 'Service offering',
    kind: 'select',
    helper: 'Changing the offering reclassifies the work — all tier-2 modules will re-run.',
    options: [], // populated dynamically by the dialog from /api/v1/service-offerings
  },
  {
    key: 'status',
    label: 'Status',
    kind: 'select',
    options: [
      { value: 'active', label: 'Active' },
      { value: 'paused', label: 'Paused' },
      { value: 'prospect', label: 'Prospect' },
      { value: 'terminated', label: 'Terminated' },
    ],
  },
]

const PROPERTY_KEY_SET = new Set(PROPERTY_FIELDS.map((f) => f.key))
const SL_KEY_SET = new Set(SERVICE_LOCATION_FIELDS.map((f) => f.key))

export function isEditablePropertyField(key: string): boolean {
  return PROPERTY_KEY_SET.has(key)
}

export function isEditableServiceLocationField(key: string): boolean {
  return SL_KEY_SET.has(key)
}

export const ADDRESS_FIELD_KEYS = PROPERTY_FIELDS.filter((f) => f.group === 'address').map((f) => f.key)
