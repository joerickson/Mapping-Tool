// Account-scoped tables (having both account_id and client_id) re-parented by
// move_client_to_account (migration 20261106161317). Single source of truth for
// the post-move straggler sweep. Drift guard:
// tests/integration/move-table-coverage.test.ts
export const MOVED_ACCOUNT_SCOPED_TABLES = [
  'service_locations', 'service_offerings', 'service_location_constraints',
  'service_location_constraint_templates', 'account_operational_constraints',
  'analysis_scenarios', 'analysis_chat_messages', 'portfolio_analyses',
  'routing_templates', 'day_schedules', 'manual_trips',
  'overnight_cluster_overrides', 'crew_vehicles', 'custom_field_definitions',
  'service_line_pricing_config', 'property_edit_history',
  'addon_cohort_assignments', 'upload_batches', 'schedule_assessments',
] as const
