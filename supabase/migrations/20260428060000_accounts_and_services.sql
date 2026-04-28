-- ============================================================
-- Accounts: top-level entity (self_managed | property_manager)
-- ============================================================
CREATE TABLE IF NOT EXISTS accounts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  display_name          TEXT,
  account_type          TEXT NOT NULL DEFAULT 'self_managed', -- 'self_managed' | 'property_manager'
  status                TEXT NOT NULL DEFAULT 'active',
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_name_lower ON accounts(LOWER(name));
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts(account_type);

DROP TRIGGER IF EXISTS accounts_set_updated_at ON accounts;
CREATE TRIGGER accounts_set_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Add account_id to clients (existing table)
-- ============================================================
DO $$ BEGIN
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_clients_account ON clients(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_account_name ON clients(account_id, LOWER(name))
  WHERE account_id IS NOT NULL;

-- ============================================================
-- Service offerings
-- ============================================================
CREATE TABLE IF NOT EXISTS service_offerings (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      TEXT NOT NULL,
  display_name              TEXT,
  description               TEXT,
  pricing_model             TEXT NOT NULL DEFAULT 'custom', -- 'fixed_per_visit'|'monthly_recurring'|'hourly'|'per_sqft'|'custom'
  default_frequency_label   TEXT,
  default_visits_per_year   NUMERIC(8,3),
  default_hours_per_visit   NUMERIC(5,2),
  default_crew_size         INTEGER,
  is_archived               BOOLEAN NOT NULL DEFAULT FALSE,
  account_id                UUID REFERENCES accounts(id) ON DELETE CASCADE,
  client_id                 UUID REFERENCES clients(id) ON DELETE CASCADE,
  metadata                  JSONB NOT NULL DEFAULT '{}',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                TEXT
);

CREATE INDEX IF NOT EXISTS idx_service_offerings_account ON service_offerings(account_id);
CREATE INDEX IF NOT EXISTS idx_service_offerings_client ON service_offerings(client_id);

-- ============================================================
-- Custom field definitions
-- ============================================================
CREATE TABLE IF NOT EXISTS custom_field_definitions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_key         TEXT NOT NULL,
  field_label       TEXT NOT NULL,
  field_type        TEXT NOT NULL, -- 'text'|'number'|'date'|'select'
  select_options    TEXT[],
  account_id        UUID REFERENCES accounts(id) ON DELETE CASCADE,
  client_id         UUID REFERENCES clients(id) ON DELETE CASCADE,
  appears_in_filters BOOLEAN NOT NULL DEFAULT TRUE,
  appears_in_groups  BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custom_field_defs_account ON custom_field_definitions(account_id);
CREATE INDEX IF NOT EXISTS idx_custom_field_defs_client ON custom_field_definitions(client_id);

-- ============================================================
-- Client templates (per-client upload column mapping)
-- ============================================================
CREATE TABLE IF NOT EXISTS client_templates (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE UNIQUE,
  upload_column_mapping   JSONB NOT NULL DEFAULT '{}',
  sheet_to_offering_mapping JSONB NOT NULL DEFAULT '{}',
  default_country         TEXT,
  is_configured           BOOLEAN NOT NULL DEFAULT FALSE,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS client_templates_set_updated_at ON client_templates;
CREATE TRIGGER client_templates_set_updated_at
  BEFORE UPDATE ON client_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Extend properties
-- ============================================================
DO $$ BEGIN
  ALTER TABLE properties ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE RESTRICT;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_properties_client ON properties(client_id);

-- ============================================================
-- Extend service_locations
-- ============================================================
DO $$ BEGIN
  ALTER TABLE service_locations ADD COLUMN IF NOT EXISTS service_offering_id UUID REFERENCES service_offerings(id) ON DELETE RESTRICT;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE service_locations ADD COLUMN IF NOT EXISTS visits_per_year_override NUMERIC(8,3);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE service_locations ADD COLUMN IF NOT EXISTS hours_per_visit_override NUMERIC(5,2);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE service_locations ADD COLUMN IF NOT EXISTS crew_size_override INTEGER;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE service_locations ADD COLUMN IF NOT EXISTS frequency_notes TEXT;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE service_locations ADD COLUMN IF NOT EXISTS price_per_visit NUMERIC(12,2);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE service_locations ADD COLUMN IF NOT EXISTS monthly_price NUMERIC(12,2);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE service_locations ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(8,2);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_service_locations_service_offering ON service_locations(service_offering_id);

-- ============================================================
-- Extend upload_batches
-- ============================================================
DO $$ BEGIN
  ALTER TABLE upload_batches ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
