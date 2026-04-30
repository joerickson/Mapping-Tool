-- Phase 4a PR2: Property editing — free-text notes, internal tags, and a
-- proper audit trail.
--
-- The existing `property_changes` table (created out-of-band in Studio,
-- not in any migration) only logged rbm_category edits. We're replacing it
-- with a richer per-edit audit table that:
--   - Captures any whitelisted field on either properties or service_locations
--   - Stores values as jsonb so strings, numbers, arrays all fit uniformly
--   - Is denormalized with account_id + client_id for fast tenant filtering
--   - Records the user's email so the UI can attribute edits to a person
--
-- The old property_changes table is left in place (legacy data preserved).
-- New writes go to property_edit_history; the existing service-locations
-- /changes endpoint will be flipped to read the new table.

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS internal_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE IF NOT EXISTS public.property_edit_history (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id          UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,

  -- Set when the edit was on a service_location row rather than the property
  -- itself. Both rows share the audit table so a single GET returns the full
  -- editing history of the property + its child SLs.
  service_location_id  UUID REFERENCES public.service_locations(id) ON DELETE CASCADE,

  account_id           UUID REFERENCES public.accounts(id) ON DELETE CASCADE,
  client_id            UUID REFERENCES public.clients(id) ON DELETE CASCADE,

  field_name           TEXT NOT NULL,
  -- jsonb, not text — stores arrays (internal_tags) and numbers
  -- (serviceable_sqft) without lossy stringification.
  old_value            JSONB,
  new_value            JSONB,

  changed_by           TEXT,
  changed_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS property_edit_history_property_idx
  ON public.property_edit_history(property_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS property_edit_history_sl_idx
  ON public.property_edit_history(service_location_id, changed_at DESC)
  WHERE service_location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS property_edit_history_tenant_idx
  ON public.property_edit_history(account_id, client_id);
