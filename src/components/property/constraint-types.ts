// Shared client-side constants for service-location constraint types.
// Mirrors api/_lib/analysis/constraint-validators.ts — keep in sync.

export type ConstraintType =
  | 'day_of_week'
  | 'blackout_dates'
  | 'seasonal_window'
  | 'time_window'
  | 'access_requirement'
  | 'contact_requirement'

export const CONSTRAINT_LABELS: Record<ConstraintType, string> = {
  day_of_week: 'Day-of-week restriction',
  blackout_dates: 'Blackout dates',
  seasonal_window: 'Seasonal window',
  time_window: 'Time-of-day window',
  access_requirement: 'Access requirement',
  contact_requirement: 'Contact requirement',
}

export const CONSTRAINT_DESCRIPTIONS: Record<ConstraintType, string> = {
  day_of_week: 'Restrict service to specific days of the week.',
  blackout_dates: 'Specific dates when service is not allowed.',
  seasonal_window: 'Service only allowed within a month range.',
  time_window: 'Service must occur within a daily time range.',
  access_requirement: 'Site access requirements (badge, escort, etc).',
  contact_requirement: 'On-site contact or advance-notice requirements.',
}

export const CONSTRAINT_GROUPS: {
  label: string
  types: ConstraintType[]
}[] = [
  { label: 'Schedule', types: ['day_of_week', 'blackout_dates', 'seasonal_window', 'time_window'] },
  { label: 'Access', types: ['access_requirement'] },
  { label: 'Operations', types: ['contact_requirement'] },
]
