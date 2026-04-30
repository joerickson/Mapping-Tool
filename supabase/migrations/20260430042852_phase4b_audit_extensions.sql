-- Phase 4b: Property editing extensions (additive on top of Phase 4a PR2).
--
-- 4a PR2 already shipped property_edit_history with property_id +
-- service_location_id columns. 4b spec'd entity_type + entity_id but the
-- existing shape is functionally equivalent (entity_type is derivable
-- from "service_location_id IS NULL ? 'property' : 'service_location'")
-- and migrating it would invalidate existing audit rows.
--
-- This migration adds two columns the spec wants but PR2 didn't ship:
--   reason: free-text rationale supplied by the editor
--   cascading_effects: jsonb summary of which analyses got marked stale,
--     synthesis triggered, etc. — captured on save so the audit log can
--     show why a downstream module went stale.

ALTER TABLE public.property_edit_history
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS cascading_effects JSONB;
