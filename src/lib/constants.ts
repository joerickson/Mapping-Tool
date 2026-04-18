export const TARGET_COLUMNS = [
  'address_line1',
  'address_line2',
  'city',
  'state',
  'postal_code',
  'location_code',
  'display_name',
  'suite_or_floor',
  'serviceable_sqft',
] as const

export type TargetColumn = typeof TARGET_COLUMNS[number]

export const REQUIRED_COLUMNS: TargetColumn[] = [
  'address_line1',
  'city',
  'state',
  'postal_code',
]

export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'GU', 'VI', 'AS', 'MP',
]

// Default category colors — overridden by color field on rbm_categories table
export const CATEGORY_COLORS: Record<string, string> = {
  office: '#1a56db',
  retail: '#0e9f6e',
  industrial: '#ff5a1f',
  medical: '#e74694',
  education: '#7e3af2',
  hospitality: '#faca15',
  multifamily: '#0694a2',
  government: '#f05252',
  mixed_use: '#6b7280',
  default: '#9ca3af',
}

export const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  paused: 'Paused',
  terminated: 'Terminated',
  prospect: 'Prospect',
}

export const STATUS_COLORS: Record<string, string> = {
  active: '#0e9f6e',
  paused: '#faca15',
  terminated: '#f05252',
  prospect: '#7e3af2',
}

export const ENRICHMENT_COST_PER_PROPERTY = {
  geocode: 0.005,
  places_nearby: 0.032,
  places_details: 0.017,
  parcel: 0.02,
  ai_classify: 0.003,
}

export const API_BASE = '/api/v1'
