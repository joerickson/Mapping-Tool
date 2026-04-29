-- Phase 2.5b: Branch Selection workflow
-- Adds the user's manually-chosen branch set on top of existing operational
-- constraints. Tier 2 modules (drive-time, crew-strategy, workforce-sizing,
-- seasonality, bid-pricing) gate on selected_branches being non-empty.
ALTER TABLE public.account_operational_constraints
  ADD COLUMN IF NOT EXISTS selected_branches          JSONB,
  ADD COLUMN IF NOT EXISTS selected_k                 INT,
  ADD COLUMN IF NOT EXISTS selected_at                TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS selected_from_analysis_id  UUID REFERENCES public.portfolio_analyses(id),
  ADD COLUMN IF NOT EXISTS selected_by                TEXT;
