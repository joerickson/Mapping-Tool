-- Stage 0 scrub results: one row per uploaded row, persisted before any geocoding
CREATE TABLE IF NOT EXISTS staged_addresses (
  staged_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_batch_id      UUID NOT NULL REFERENCES upload_batches(upload_batch_id) ON DELETE CASCADE,
  row_index            INTEGER NOT NULL,
  original_row         JSONB NOT NULL,
  scrub_status         TEXT NOT NULL DEFAULT 'clean',
  -- clean | auto_corrected | needs_review | rejected | duplicate | existing_property
  scrub_corrections    JSONB,
  scrub_confidence     NUMERIC(3,2),
  scrub_issues         JSONB,
  dedupe_hash          TEXT,
  canonical_staged_id  UUID REFERENCES staged_addresses(staged_id),
  existing_property_id UUID,
  usps_verified        BOOLEAN,
  usps_response        JSONB,
  validated_address    JSONB,
  user_action          TEXT,
  -- approved | skip | merge | treat_as_new
  user_edited_address  JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staged_batch     ON staged_addresses(upload_batch_id);
CREATE INDEX IF NOT EXISTS idx_staged_hash      ON staged_addresses(dedupe_hash);
CREATE INDEX IF NOT EXISTS idx_staged_status    ON staged_addresses(scrub_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_staged_batch_row ON staged_addresses(upload_batch_id, row_index);
