-- Phase 3.9a — manual branch assignment override on properties.
--
-- NULL = use auto-assigned (nearest branch by haversine).
-- Non-null = forces this property to a specific branch by name. The
-- name must match one of the account's selected branch names; if it
-- doesn't (e.g. branch was renamed/removed), the analyzer falls back
-- to nearest-branch.
--
-- This lets users dynamically rebalance the per-branch property
-- allocation in Crew Strategy to optimize utilization.

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS branch_override text,
  ADD COLUMN IF NOT EXISTS branch_override_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS branch_override_changed_by text;
