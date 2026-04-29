-- Add address validation and geocoding tracking columns to properties
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS address_validation_result    jsonb,
  ADD COLUMN IF NOT EXISTS address_validated_at         timestamp with time zone,
  ADD COLUMN IF NOT EXISTS address_validation_verdict   text,
  -- 'CONFIRMED' | 'CONFIRMED_WITH_CORRECTIONS' | 'UNCONFIRMED' | 'UNCONFIRMED_BUT_PLAUSIBLE' | 'INFERRED'
  ADD COLUMN IF NOT EXISTS validated_address_line1      text,
  ADD COLUMN IF NOT EXISTS validated_city               text,
  ADD COLUMN IF NOT EXISTS validated_state              text,
  ADD COLUMN IF NOT EXISTS validated_postal_code        text,
  ADD COLUMN IF NOT EXISTS validated_country            text;

-- Also ensure google_place_id and last_enriched_at exist (used by enrichment endpoints)
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS google_place_id   text,
  ADD COLUMN IF NOT EXISTS last_enriched_at  timestamp with time zone;

-- Enrichment tracking columns
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS enrichment_status  text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS enrichment_errors  jsonb,
  ADD COLUMN IF NOT EXISTS geocode_source     text,
  ADD COLUMN IF NOT EXISTS geocode_confidence text,
  ADD COLUMN IF NOT EXISTS geocoded_at        timestamp with time zone;

-- Index to find pending/failed properties quickly during backfill
CREATE INDEX IF NOT EXISTS properties_enrichment_status_idx
  ON public.properties(enrichment_status)
  WHERE enrichment_status IN ('pending', 'failed');
