-- Service API Keys (hashed, never plaintext)
CREATE TABLE IF NOT EXISTS service_api_keys (
  key_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_name    TEXT NOT NULL,
  key_prefix       TEXT NOT NULL,
  key_hash         TEXT NOT NULL UNIQUE,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at     TIMESTAMPTZ,
  revoked_at       TIMESTAMPTZ
);

-- Per-request access log for service keys
CREATE TABLE IF NOT EXISTS service_api_key_logs (
  log_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id      UUID REFERENCES service_api_keys(key_id),
  endpoint    TEXT NOT NULL,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_key_logs_key_id ON service_api_key_logs(key_id);
CREATE INDEX IF NOT EXISTS idx_key_logs_created_at ON service_api_key_logs(created_at);

-- Webhook delivery log
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL,
  consumer        TEXT NOT NULL,
  url             TEXT NOT NULL,
  attempt_number  INT NOT NULL DEFAULT 1,
  status_code     INT,
  response_body   TEXT,
  delivered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wh_event_id ON webhook_deliveries(event_id);
CREATE INDEX IF NOT EXISTS idx_wh_created_at ON webhook_deliveries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wh_consumer ON webhook_deliveries(consumer);

-- Embed tokens (DB-backed, replaces need for a JWT library)
CREATE TABLE IF NOT EXISTS embed_tokens (
  token_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token       TEXT NOT NULL UNIQUE,
  scope       JSONB NOT NULL DEFAULT '{}',
  expires_at  TIMESTAMPTZ NOT NULL,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_embed_tokens_token ON embed_tokens(token);

-- Extend portfolios with new fields (skipped silently on fresh DBs where portfolios doesn't exist yet)
DO $$ BEGIN
  ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS portfolio_type TEXT NOT NULL DEFAULT 'custom';
  ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS client_id TEXT;
  ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS bid_id TEXT;
  ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS show_financials BOOLEAN NOT NULL DEFAULT false;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Extend service_locations with contract fields (skipped silently on fresh DBs)
DO $$ BEGIN
  ALTER TABLE service_locations ADD COLUMN IF NOT EXISTS service_frequency TEXT;
  ALTER TABLE service_locations ADD COLUMN IF NOT EXISTS service_schedule JSONB;
  ALTER TABLE service_locations ADD COLUMN IF NOT EXISTS monthly_contract_value NUMERIC(12,2);
  ALTER TABLE service_locations ADD COLUMN IF NOT EXISTS contract_id TEXT;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- PostGIS extension (harmless no-op if already enabled)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Stub tables so nearby_properties can be created on fresh DBs
-- (real tables exist in production via Studio; these are no-ops there)
CREATE TABLE IF NOT EXISTS properties (
  property_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  latitude     FLOAT8,
  longitude    FLOAT8
);

CREATE TABLE IF NOT EXISTS service_locations (
  service_location_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id          UUID,
  display_name         TEXT,
  status               TEXT,
  client_id            TEXT
);

-- Proximity function using PostGIS (falls back to Haversine math if no PostGIS)
CREATE OR REPLACE FUNCTION nearby_properties(
  query_lat   FLOAT8,
  query_lng   FLOAT8,
  radius_mi   FLOAT8 DEFAULT 15
)
RETURNS TABLE (
  property_id       UUID,
  distance_miles    FLOAT8,
  service_locations JSONB
) LANGUAGE sql STABLE AS $$
  WITH dists AS (
    SELECT
      p.property_id,
      3959.0 * acos(LEAST(1.0,
        cos(radians(query_lat)) * cos(radians(p.latitude)) *
          cos(radians(p.longitude) - radians(query_lng)) +
        sin(radians(query_lat)) * sin(radians(p.latitude))
      )) AS distance_miles
    FROM properties p
    WHERE p.latitude IS NOT NULL AND p.longitude IS NOT NULL
  ),
  nearby AS (
    SELECT * FROM dists WHERE distance_miles <= radius_mi
  )
  SELECT
    n.property_id,
    n.distance_miles,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'service_location_id', sl.service_location_id,
          'display_name',        sl.display_name,
          'status',              sl.status,
          'client_id',           sl.client_id
        )
      ) FILTER (WHERE sl.service_location_id IS NOT NULL),
      '[]'::jsonb
    ) AS service_locations
  FROM nearby n
  LEFT JOIN service_locations sl
    ON sl.property_id = n.property_id
   AND sl.status != 'terminated'
  GROUP BY n.property_id, n.distance_miles
  ORDER BY n.distance_miles;
$$;
