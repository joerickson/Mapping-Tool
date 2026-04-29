-- Smart Analysis Phase 1
-- Adds portfolio_analyses table for storing structured analysis output
-- and risk-flag columns to properties for per-property risk assessment.

CREATE TABLE IF NOT EXISTS public.portfolio_analyses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  client_id       UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  module_key      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  inputs          JSONB,
  outputs         JSONB,
  summary_text    TEXT,
  property_count  INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  error_message   TEXT,
  created_by      TEXT,
  CONSTRAINT portfolio_analyses_module_key_check CHECK (module_key IN (
    'geographic_distribution',
    'branch_optimization',
    'crew_strategy',
    'workforce_sizing',
    'drive_time_logistics',
    'seasonality_capacity',
    'bid_pricing_structure',
    'synthesis'
  ))
);

CREATE INDEX IF NOT EXISTS portfolio_analyses_account_module_idx
  ON public.portfolio_analyses(account_id, module_key, created_at DESC);

CREATE INDEX IF NOT EXISTS portfolio_analyses_status_idx
  ON public.portfolio_analyses(status) WHERE status IN ('pending', 'running');

-- Per-property risk assessment columns
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS risk_flags        JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS risk_score        NUMERIC,
  ADD COLUMN IF NOT EXISTS risk_assessed_at  TIMESTAMPTZ;
