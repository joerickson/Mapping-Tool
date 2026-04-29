-- Phase 2.5c + 2.5d
-- 2.5c: Branch Optimization picks branch locations from cities above a
--       configurable population threshold so labor recruiting is feasible.
-- 2.5d: Crew Strategy sizes crews to fit a utilization band — hard floor
--       75%, soft ceiling 110%, ideal 80–100%, evaluated at one of three
--       scopes (per_branch | per_region | portfolio).
-- Both constraints stored as JSONB on account_operational_constraints so
-- adding/removing fields later doesn't require a schema change.

ALTER TABLE public.account_operational_constraints
  ADD COLUMN IF NOT EXISTS population_constraint  JSONB DEFAULT '{
    "enabled": true,
    "min_population": 50000
  }'::jsonb,
  ADD COLUMN IF NOT EXISTS utilization_constraint JSONB DEFAULT '{
    "enabled": true,
    "hard_floor_pct": 75,
    "soft_ceiling_pct": 110,
    "ideal_min_pct": 80,
    "ideal_max_pct": 100,
    "scope": "per_branch"
  }'::jsonb;
