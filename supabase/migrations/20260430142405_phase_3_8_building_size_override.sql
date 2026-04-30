-- Phase 3.8 — per-service-location override of auto-computed building
-- size class. NULL means use the auto-computed class from
-- hours_per_visit; a non-null value forces a specific class.

ALTER TABLE public.service_locations
  ADD COLUMN IF NOT EXISTS building_size_class_override text,
  ADD COLUMN IF NOT EXISTS building_size_override_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'service_locations_building_size_class_override_check'
  ) THEN
    ALTER TABLE public.service_locations
      ADD CONSTRAINT service_locations_building_size_class_override_check
      CHECK (
        building_size_class_override IS NULL OR
        building_size_class_override IN ('small', 'standard', 'large', 'multi_day')
      );
  END IF;
END $$;
