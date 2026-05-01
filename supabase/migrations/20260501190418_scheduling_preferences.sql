-- Adds client-level scheduling preferences that drive the routing engine.
--   cluster_radius_miles: properties within this radius get grouped into the
--     same trip (= contiguous block on the calendar).
--   pairing_max_drive_minutes: two properties can share a day only if within
--     this drive time of each other.
--   pairing_max_combined_sqft: two properties can share a day only if their
--     summed serviceable_sqft is at most this. Replaces the legacy
--     "both must be 'small' size class" rule.
--   pairing_max_buildings_per_day: hard cap on stops per crew day (default 2).
ALTER TABLE public.account_operational_constraints
  ADD COLUMN IF NOT EXISTS scheduling_preferences jsonb NOT NULL DEFAULT
    '{
       "cluster_radius_miles": 30,
       "pairing_max_drive_minutes": 30,
       "pairing_max_combined_sqft": 20000,
       "pairing_max_buildings_per_day": 2
     }'::jsonb;
