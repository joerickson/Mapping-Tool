-- Phase 4d follow-up: human-readable trip labels.
--
-- The template builder generates cluster_id values like "local-0" /
-- "remote-0" and trip_id values like "local-0-v1" — internal IDs that
-- aren't useful in the UI. Phase 4d follow-up populates trip_label
-- (e.g. "Frisco TX (local) – Visit 1", "El Paso, TX") on every newly-
-- generated crew_day_route. Existing rows from earlier templates retain
-- NULL until the template is regenerated (or backfilled by hand).

ALTER TABLE public.crew_day_routes
  ADD COLUMN IF NOT EXISTS trip_label TEXT;
