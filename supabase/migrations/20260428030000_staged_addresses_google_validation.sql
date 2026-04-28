-- Add Google Address Validation columns to staged_addresses
-- Replaces the Smarty validation step (Stage 0c)
ALTER TABLE staged_addresses
  ADD COLUMN IF NOT EXISTS validation_granularity TEXT,
  ADD COLUMN IF NOT EXISTS latitude              NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS longitude             NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS geocoded_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS geocode_source        TEXT;

COMMENT ON COLUMN staged_addresses.validation_granularity IS
  'Google Address Validation verdict: PREMISE, SUB_PREMISE, PREMISE_PROXIMITY, BLOCK, ROUTE, or OTHER';
COMMENT ON COLUMN staged_addresses.geocode_source IS
  'Source of lat/lng: google_address_validation (Stage 0c). If present, Stage 1 geocoding is skipped.';
