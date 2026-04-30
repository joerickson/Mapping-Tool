-- Phase 3.9 — convert flat cost constants (branch overhead, insurance,
-- vehicle lease) into structured calculations with main/satellite
-- branch types. Each cost remains overridable as a flat value.

-- ── Branch overhead config ───────────────────────────────────────
ALTER TABLE public.account_operational_constraints
  ADD COLUMN IF NOT EXISTS branch_overhead_config jsonb DEFAULT '{
    "main_defaults": {
      "rent_monthly": 5000,
      "utilities_monthly": 800,
      "manager_salary_annual": 75000,
      "manager_burden_pct": 28,
      "other_operational_monthly": 2000
    },
    "satellite_defaults": {
      "rent_monthly": 2500,
      "utilities_monthly": 400,
      "manager_salary_annual": 0,
      "manager_burden_pct": 28,
      "other_operational_monthly": 1000
    }
  }'::jsonb,
  ADD COLUMN IF NOT EXISTS branch_overhead_overrides jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS branch_overhead_annual_override numeric;

-- ── Insurance config ─────────────────────────────────────────────
ALTER TABLE public.account_operational_constraints
  ADD COLUMN IF NOT EXISTS insurance_config jsonb DEFAULT '{
    "calculation_method": "percentage_of_revenue",
    "percentage_of_revenue": 1.5,
    "minimum_annual_premium": 5000
  }'::jsonb,
  ADD COLUMN IF NOT EXISTS insurance_annual_override numeric;

-- ── Vehicle config ───────────────────────────────────────────────
ALTER TABLE public.account_operational_constraints
  ADD COLUMN IF NOT EXISTS vehicle_config jsonb DEFAULT '{
    "default_vehicles_per_crew": 1,
    "default_ownership_type": "lease",
    "ownership_defaults": {
      "lease": {
        "monthly_lease": 600,
        "monthly_maintenance": 150,
        "annual_registration": 200,
        "annual_insurance": 1800
      },
      "purchase": {
        "monthly_payment": 800,
        "monthly_maintenance": 200,
        "annual_registration": 200,
        "annual_insurance": 1600,
        "annual_depreciation_estimate": 4000
      },
      "personal_vehicle_reimbursement": {
        "rate_per_mile": 0.67,
        "monthly_stipend": 0
      }
    }
  }'::jsonb,
  ADD COLUMN IF NOT EXISTS vehicle_lease_annual_per_crew_override numeric;

-- ── crew_vehicles ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crew_vehicles (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                    uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  client_id                     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  crew_label                    text NOT NULL,
  vehicle_index                 int  NOT NULL DEFAULT 0,

  ownership_type                text NOT NULL,

  monthly_lease_override        numeric,
  monthly_payment_override      numeric,
  monthly_maintenance_override  numeric,
  annual_registration_override  numeric,
  annual_insurance_override     numeric,
  annual_depreciation_override  numeric,
  rate_per_mile_override        numeric,
  monthly_stipend_override      numeric,

  notes                         text,
  created_at                    timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crew_vehicles_ownership_chk') THEN
    ALTER TABLE public.crew_vehicles
      ADD CONSTRAINT crew_vehicles_ownership_chk CHECK (
        ownership_type IN ('lease', 'purchase', 'personal_vehicle_reimbursement')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS crew_vehicles_account_client_idx
  ON public.crew_vehicles(account_id, client_id, crew_label);

-- ── Backfill branch_type='main' on existing selected_branches ──
-- selected_branches is jsonb on account_operational_constraints. Existing
-- rows pre-date Phase 3.9 and have no branch_type field on their entries.
-- Default to 'main' so the calculators still work; users can re-classify
-- specific branches as satellites afterward.
UPDATE public.account_operational_constraints
SET selected_branches = (
  SELECT jsonb_agg(
    CASE
      WHEN branch ? 'branch_type' THEN branch
      ELSE branch || '{"branch_type": "main"}'::jsonb
    END
  )
  FROM jsonb_array_elements(selected_branches) AS branch
)
WHERE selected_branches IS NOT NULL
  AND jsonb_array_length(selected_branches) > 0
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(selected_branches) AS b
    WHERE NOT (b ? 'branch_type')
  );
