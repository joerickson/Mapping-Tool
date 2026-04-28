-- Upload pipeline v2: multi-sheet, service offering mapping, async Edge Function
-- Extends upload_batches and adds upload_staged_rows for pre-commit staging.

-- ── Extend upload_batches ─────────────────────────────────────────────────────
ALTER TABLE upload_batches
  ADD COLUMN IF NOT EXISTS source_filename TEXT,
  ADD COLUMN IF NOT EXISTS file_path       TEXT,
  ADD COLUMN IF NOT EXISTS detected_format TEXT,        -- 'csv' | 'xlsx' | 'xls'
  ADD COLUMN IF NOT EXISTS sheets          JSONB,       -- [{name, row_count, columns[]}]
  ADD COLUMN IF NOT EXISTS total_rows      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processing_config JSONB,    -- sheet/column mappings confirmed at step 3
  ADD COLUMN IF NOT EXISTS summary_stats  JSONB,       -- final counts after Edge Function
  ADD COLUMN IF NOT EXISTS batch_tag      TEXT,
  ADD COLUMN IF NOT EXISTS current_sheet  TEXT,
  ADD COLUMN IF NOT EXISTS errors_count   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS committed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at   TIMESTAMPTZ;

-- ── custom_fields on service_locations ───────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE service_locations ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ── account_id on service_locations ──────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE service_locations ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ── Staged rows (pre-commit) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS upload_staged_rows (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_batch_id       UUID NOT NULL REFERENCES upload_batches(upload_batch_id) ON DELETE CASCADE,
  sheet_name            TEXT NOT NULL,
  row_index             INTEGER NOT NULL,
  service_offering_id   UUID REFERENCES service_offerings(id),
  outcome               TEXT NOT NULL DEFAULT 'pending',
  -- valid | invalid | corrected | duplicate_within_batch | duplicate_existing
  dedupe_hash           TEXT,
  property_data         JSONB NOT NULL DEFAULT '{}',
  service_location_data JSONB NOT NULL DEFAULT '{}',
  error_messages        TEXT[],
  corrections           JSONB,
  existing_property_id  UUID,
  property_id           UUID,
  service_location_id   UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staged_rows_batch   ON upload_staged_rows(upload_batch_id);
CREATE INDEX IF NOT EXISTS idx_staged_rows_hash    ON upload_staged_rows(dedupe_hash);
CREATE INDEX IF NOT EXISTS idx_staged_rows_outcome ON upload_staged_rows(outcome);
CREATE UNIQUE INDEX IF NOT EXISTS idx_staged_rows_batch_sheet_row
  ON upload_staged_rows(upload_batch_id, sheet_name, row_index);
