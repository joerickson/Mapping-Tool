-- Client map share link: per-client share token + optional expiry.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS share_token text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS share_expires_at timestamptz;
-- Partial unique index so many NULL tokens are allowed.
CREATE UNIQUE INDEX IF NOT EXISTS clients_share_token_key ON clients (share_token) WHERE share_token IS NOT NULL;
