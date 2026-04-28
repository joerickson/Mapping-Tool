-- Base table stub: created here for preview-branch compatibility (production already has this table)
CREATE TABLE IF NOT EXISTS upload_batches (
  upload_batch_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename        TEXT,
  row_count       INTEGER NOT NULL DEFAULT 0,
  raw_data        JSONB NOT NULL DEFAULT '[]',
  column_mapping  JSONB NOT NULL DEFAULT '{}',
  client_id       TEXT,
  portfolio_id    UUID,
  uploaded_by     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure upload_batch_id exists and is referenceable on pre-existing production tables.
-- On fresh preview DBs the CREATE TABLE above already defines it as PK; this block is a no-op.
-- On production tables predating this migration the column may be absent (e.g. PK is named "id"),
-- so we add it and give it a UNIQUE constraint so staged_addresses can FK-reference it.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'upload_batches'
      AND column_name  = 'upload_batch_id'
  ) THEN
    ALTER TABLE upload_batches
      ADD COLUMN upload_batch_id UUID NOT NULL DEFAULT gen_random_uuid();
    ALTER TABLE upload_batches
      ADD CONSTRAINT upload_batches_upload_batch_id_unique UNIQUE (upload_batch_id);
  END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

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
