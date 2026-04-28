-- Clients table: first-class entity scoping all service data
CREATE TABLE IF NOT EXISTS clients (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  display_name          TEXT,
  status                TEXT NOT NULL DEFAULT 'active', -- active | prospect | churned
  notes                 TEXT,
  primary_contact_name  TEXT,
  primary_contact_email TEXT,
  primary_contact_phone TEXT,
  brand_color           TEXT,
  logo_url              TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_name_lower ON clients(LOWER(name));
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS clients_set_updated_at ON clients;
CREATE TRIGGER clients_set_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Ensure service_locations has a UUID client_id referencing clients
-- Production columns may be TEXT; convert if safe (no non-UUID data yet).
DO $$ BEGIN
  -- If client_id is TEXT, drop and re-add as UUID
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'service_locations'
      AND column_name = 'client_id' AND data_type = 'text'
  ) THEN
    ALTER TABLE service_locations DROP COLUMN client_id;
  END IF;
  ALTER TABLE service_locations ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- portfolios.client_id
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'portfolios'
      AND column_name = 'client_id' AND data_type = 'text'
  ) THEN
    ALTER TABLE portfolios DROP COLUMN client_id;
  END IF;
  ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- upload_batches.client_id
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'upload_batches'
      AND column_name = 'client_id' AND data_type = 'text'
  ) THEN
    ALTER TABLE upload_batches DROP COLUMN client_id;
  END IF;
  ALTER TABLE upload_batches ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- custom_field_definitions.client_id (if table exists)
DO $$ BEGIN
  ALTER TABLE custom_field_definitions ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);
EXCEPTION WHEN undefined_table THEN NULL;
WHEN OTHERS THEN NULL;
END $$;
