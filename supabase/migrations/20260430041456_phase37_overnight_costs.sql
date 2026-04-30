-- Phase 3.7: Calculated overnight & hotel costs.
--
-- Replaces the flat $35K hotels_annual constant with a calculated value
-- based on which properties are >3hr from their nearest branch, density-
-- clustered geographically, with work_days_per_trip and nights_per_trip
-- driving the cost rollup.
--
-- Two new columns:
--   hotel_cost_config: knobs for the calc (cost_per_night, trigger hours,
--     work-hour cap, per diem). Stored as jsonb so the schema can extend
--     without migrations (e.g. regional pricing later).
--   hotels_annual_override: nullable numeric. When set, modules use this
--     flat value INSTEAD of the calculated number. Lets a user pin a
--     specific dollar figure (matched bid number, contractual amount,
--     etc.) without losing the ability to compare against the calc.
--
-- The legacy hotels_annual column stays — it's now a "fallback default"
-- for situations where calculation isn't possible (no selected branches
-- on the dashboard yet) and the user hasn't set an override.

ALTER TABLE public.account_operational_constraints
  ADD COLUMN IF NOT EXISTS hotel_cost_config JSONB
    DEFAULT '{
      "cost_per_night": 120,
      "overnight_trigger_one_way_hours": 3,
      "max_work_hours_per_crew_day": 8,
      "buffer_hours_per_day": 2,
      "per_diem_per_night": 50,
      "include_per_diem": true
    }'::jsonb;

ALTER TABLE public.account_operational_constraints
  ADD COLUMN IF NOT EXISTS hotels_annual_override NUMERIC DEFAULT NULL;
