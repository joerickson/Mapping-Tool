-- Fix nearby_properties() to use the real PK columns (properties.id, service_locations.id)
-- rather than the legacy stub-table column names (property_id, service_location_id).
--
-- The output column names (property_id, service_location_id inside the JSONB) are
-- preserved so api/v1/proximity.ts and any other consumer keeps working without changes.
--
-- plpgsql resolves column references at execution time, so this CREATE OR REPLACE
-- succeeds against fresh preview DBs even if the underlying tables don't exist yet.

CREATE OR REPLACE FUNCTION nearby_properties(
  query_lat   FLOAT8,
  query_lng   FLOAT8,
  radius_mi   FLOAT8 DEFAULT 15
)
RETURNS TABLE (
  property_id       UUID,
  distance_miles    FLOAT8,
  service_locations JSONB
) LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
  WITH dists AS (
    SELECT
      p.id AS property_id,
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
          'service_location_id', sl.id,
          'display_name',        sl.display_name,
          'status',              sl.status,
          'client_id',           sl.client_id
        )
      ) FILTER (WHERE sl.id IS NOT NULL),
      '[]'::jsonb
    ) AS service_locations
  FROM nearby n
  LEFT JOIN service_locations sl
    ON sl.property_id = n.property_id
   AND sl.status != 'terminated'
  GROUP BY n.property_id, n.distance_miles
  ORDER BY n.distance_miles;
END;
$$;
