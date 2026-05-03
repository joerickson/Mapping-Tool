-- Geocode-based matching for schedule assessments. Each row gets
-- geocoded once at upload time; the result lives on the row so a
-- re-match (or "not in portfolio → add as new SL") doesn't re-hit
-- the Google API.
ALTER TABLE public.schedule_assessment_rows
  ADD COLUMN IF NOT EXISTS raw_city text,
  ADD COLUMN IF NOT EXISTS raw_state text,
  ADD COLUMN IF NOT EXISTS raw_postal_code text,
  ADD COLUMN IF NOT EXISTS geocoded_lat double precision,
  ADD COLUMN IF NOT EXISTS geocoded_lng double precision,
  ADD COLUMN IF NOT EXISTS geocoded_formatted_address text,
  ADD COLUMN IF NOT EXISTS geocoded_confidence text,
  ADD COLUMN IF NOT EXISTS geocoded_status text, -- 'pending'|'ok'|'failed'|'cached'
  ADD COLUMN IF NOT EXISTS match_distance_feet double precision;

-- Add indexes for common lookups by geocode status (e.g. "show me
-- everything that needs geocoding") and for spatial queries.
CREATE INDEX IF NOT EXISTS schedule_assessment_rows_geocode_status_idx
  ON public.schedule_assessment_rows(assessment_id, geocoded_status)
  WHERE geocoded_status IS NOT NULL;
