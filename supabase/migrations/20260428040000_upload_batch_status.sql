-- Add async processing status tracking to upload_batches
ALTER TABLE upload_batches
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS rows_processed INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS validation_errors_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_corrections_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

CREATE INDEX IF NOT EXISTS idx_upload_batches_status ON upload_batches(status)
  WHERE status IN ('queued', 'processing');
