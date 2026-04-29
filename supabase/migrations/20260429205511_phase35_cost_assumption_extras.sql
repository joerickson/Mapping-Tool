-- Phase 3.5 — Cost Assumptions transparency
-- Adds three more per-account override columns surfaced on the Cost
-- Assumptions panel: working_days_per_year (crew availability denominator),
-- visits_per_year_default (fallback when service_location.visits_per_year_override
-- is NULL), and labor_burden_breakdown (jsonb of which components are baked
-- into hourly_loaded_labor_cost — wages/payroll/wc/benefits/training).

ALTER TABLE public.account_operational_constraints
  ADD COLUMN IF NOT EXISTS working_days_per_year   INT,
  ADD COLUMN IF NOT EXISTS visits_per_year_default INT,
  ADD COLUMN IF NOT EXISTS labor_burden_breakdown  JSONB DEFAULT '{
    "wages": true,
    "payroll_taxes": true,
    "workers_comp": true,
    "benefits": true,
    "training": false
  }'::jsonb;
