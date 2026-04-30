-- Rename properties.property_id → properties.id and
-- service_locations.service_location_id → service_locations.id.
--
-- On production this rename was done out-of-band in Studio long ago, so
-- this migration is a no-op there (the columns are already named `id`).
-- On a fresh preview DB the rename never happened, and the subsequent
-- Phase 4a/4b/4c migrations (which reference `properties(id)` and
-- `service_locations(id)` in foreign keys) fail with:
--   ERROR: column "id" referenced in foreign key constraint does not exist
--
-- This migration goes BEFORE the FK references so fresh DBs match prod.
--
-- Idempotent: only renames when the old name is present and the new name
-- isn't — so re-running on an already-renamed DB does nothing.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'service_locations'
      AND column_name = 'service_location_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'service_locations'
      AND column_name = 'id'
  ) THEN
    ALTER TABLE public.service_locations RENAME COLUMN service_location_id TO id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'properties'
      AND column_name = 'property_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'properties'
      AND column_name = 'id'
  ) THEN
    ALTER TABLE public.properties RENAME COLUMN property_id TO id;
  END IF;
END $$;
