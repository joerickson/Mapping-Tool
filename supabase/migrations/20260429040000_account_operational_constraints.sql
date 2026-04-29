-- Per-account operational constraints. Centralizes the per-account overrides
-- (existing branch infrastructure, properties to exclude from analysis,
-- crew economics, cost assumptions, margin targets) so every module run reads
-- the same set of defaults instead of falling back to hardcoded values.

CREATE TABLE IF NOT EXISTS public.account_operational_constraints (
  account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  client_id  UUID REFERENCES public.clients(id) ON DELETE CASCADE,

  -- Existing infrastructure
  -- existing_branches is an array of { name, address, lat, lng, locked }
  existing_branches      JSONB DEFAULT '[]'::jsonb,

  -- Properties to exclude from analysis (e.g. already covered by other crews)
  excluded_property_ids   UUID[] DEFAULT ARRAY[]::uuid[],
  excluded_property_reason TEXT,

  -- Crew economics overrides (NULL = use system default in the module)
  crew_size                          INT,
  hours_per_day                      NUMERIC,
  hourly_loaded_labor_cost           NUMERIC,

  -- Productivity rule overrides
  project_clean_base_hours           NUMERIC,
  project_clean_hours_per_sqft       NUMERIC,
  upholstery_solo_hours              NUMERIC,
  upholstery_combo_hours_pct         NUMERIC,
  recurring_productivity_sqft_per_hour NUMERIC,

  -- Fuel/vehicle
  fuel_cost_per_mile                 NUMERIC,
  vehicles_per_crew                  INT,

  -- Surge model
  surge_weeks_per_year               INT,
  surge_crew_count                   INT,
  surge_premium_multiplier           NUMERIC,

  -- Operational costs
  branch_overhead_annual             NUMERIC,
  hotels_annual                      NUMERIC,
  vehicle_lease_annual_per_crew      NUMERIC,
  supplies_pct_of_labor              NUMERIC,
  insurance_annual                   NUMERIC,

  -- Margin
  corporate_overhead_pct             NUMERIC,
  target_gross_margin_pct            NUMERIC,

  -- Drive parameters
  drive_speed_mph                    NUMERIC,
  max_one_way_drive_minutes          INT,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS account_operational_constraints_client_idx
  ON public.account_operational_constraints(client_id);
