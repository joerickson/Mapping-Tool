-- Phase 4.5d — branch assignment recommendations + overrides on routing templates.
-- branch_assignments (engine output): per-property recommendation from the
-- capacity-circle rebalance pass. Shape:
--   [{ service_location_id, property_id, address, recommended_branch_idx,
--      assigned_branch_idx, nearest_branch_idx, transferred, reason? }, ...]
-- branch_assignment_overrides (operator input): force a property to a
-- specific branch index regardless of the engine's recommendation.
--   { service_location_id: branch_idx, ... }
ALTER TABLE public.routing_templates
  ADD COLUMN IF NOT EXISTS branch_assignments jsonb,
  ADD COLUMN IF NOT EXISTS branch_assignment_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;
