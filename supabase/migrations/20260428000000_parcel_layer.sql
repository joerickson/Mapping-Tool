-- County FIPS lookup cache (Census Geocoder results, keyed by rounded lat/lng)
CREATE TABLE IF NOT EXISTS geo_county_cache (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lat_key     NUMERIC(8,4) NOT NULL,
  lng_key     NUMERIC(8,4) NOT NULL,
  county_fips TEXT NOT NULL,
  county_name TEXT,
  state       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_geo_county_cache_coords ON geo_county_cache(lat_key, lng_key);

-- Notification dedup log — prevents re-alerting the same county within 30 days
CREATE TABLE IF NOT EXISTS parcel_notification_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  county_fips       TEXT NOT NULL,
  county_name       TEXT,
  state             TEXT,
  threshold_crossed INTEGER NOT NULL,
  notified_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_parcel_notification_county ON parcel_notification_log(county_fips);

-- Stub table so find_nearest_parcel can be created on fresh DBs
-- (real table exists in production via Studio; this is a no-op there)
CREATE TABLE IF NOT EXISTS parcels (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  regrid_ll_uuid        TEXT,
  parcel_number         TEXT,
  county_fips           TEXT,
  state                 TEXT,
  county_name           TEXT,
  geometry              JSONB,
  centroid_lat          NUMERIC,
  centroid_lng          NUMERIC,
  building_sqft         INTEGER,
  lot_sqft              INTEGER,
  year_built            INTEGER,
  zoning_code           TEXT,
  land_use_code         TEXT,
  land_use_standardized TEXT,
  owner_name            TEXT,
  owner_mailing_address TEXT,
  source_refresh_date   DATE,
  imported_at           TIMESTAMPTZ
);

-- Nearest-parcel lookup via Haversine (PostGIS-free).
-- Returns the single nearest parcel within p_max_distance_m metres, or empty set.
CREATE OR REPLACE FUNCTION find_nearest_parcel(
  p_county_fips    TEXT,
  p_lat            DOUBLE PRECISION,
  p_lng            DOUBLE PRECISION,
  p_max_distance_m DOUBLE PRECISION DEFAULT 100
)
RETURNS TABLE (
  id                    UUID,
  regrid_ll_uuid        TEXT,
  parcel_number         TEXT,
  county_fips           TEXT,
  state                 TEXT,
  county_name           TEXT,
  geometry              JSONB,
  centroid_lat          NUMERIC,
  centroid_lng          NUMERIC,
  building_sqft         INTEGER,
  lot_sqft              INTEGER,
  year_built            INTEGER,
  zoning_code           TEXT,
  land_use_code         TEXT,
  land_use_standardized TEXT,
  owner_name            TEXT,
  owner_mailing_address TEXT,
  source_refresh_date   DATE,
  imported_at           TIMESTAMPTZ,
  distance_m            DOUBLE PRECISION
)
LANGUAGE sql STABLE AS $$
  SELECT
    p.id,
    p.regrid_ll_uuid,
    p.parcel_number,
    p.county_fips,
    p.state,
    p.county_name,
    p.geometry,
    p.centroid_lat,
    p.centroid_lng,
    p.building_sqft,
    p.lot_sqft,
    p.year_built,
    p.zoning_code,
    p.land_use_code,
    p.land_use_standardized,
    p.owner_name,
    p.owner_mailing_address,
    p.source_refresh_date,
    p.imported_at,
    6371000.0 * acos(
      LEAST(1.0,
        cos(radians(p_lat)) * cos(radians(p.centroid_lat::double precision))
        * cos(radians(p.centroid_lng::double precision) - radians(p_lng))
        + sin(radians(p_lat)) * sin(radians(p.centroid_lat::double precision))
      )
    ) AS distance_m
  FROM (
    SELECT *
    FROM parcels
    WHERE
      county_fips = p_county_fips
      AND centroid_lat IS NOT NULL
      AND centroid_lng IS NOT NULL
      AND centroid_lat BETWEEN p_lat - (p_max_distance_m / 111320.0)
                           AND p_lat + (p_max_distance_m / 111320.0)
      AND centroid_lng BETWEEN p_lng - (p_max_distance_m / (111320.0 * cos(radians(p_lat))))
                           AND p_lng + (p_max_distance_m / (111320.0 * cos(radians(p_lat))))
  ) p
  ORDER BY distance_m ASC
  LIMIT 1
$$;
