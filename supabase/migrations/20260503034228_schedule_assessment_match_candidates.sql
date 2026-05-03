-- Persist top-3 fuzzy match candidates per assessment row so the
-- review tray can render them inline without a separate "Load SL
-- list" click. Each candidate: { sl_id, address_line1, score }.
ALTER TABLE public.schedule_assessment_rows
  ADD COLUMN IF NOT EXISTS match_candidates jsonb;

-- Optional raw-CSV column for explicit location-code lookups (bypasses
-- fuzzy address matching when present). Stored separately from
-- raw_address so we can show both in the review UI when needed.
ALTER TABLE public.schedule_assessment_rows
  ADD COLUMN IF NOT EXISTS raw_location_code text;
