-- Phase 4c: scheduler core. One row = one planned day.
--
-- The route is stored as jsonb (sequence of stops with timestamps + drive
-- legs + constraint violations) so we don't have to model the per-stop
-- schema relationally yet. Multi-day, multi-crew, recurring patterns
-- come in 4d-4f and may want a dedicated stops table; for now the
-- jsonb shape lets the routing engine evolve freely.

CREATE TABLE IF NOT EXISTS public.day_schedules (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id               UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  client_id                UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  -- Plan metadata
  name                     TEXT,
  description              TEXT,
  scheduled_date           DATE,
  branch_name              TEXT NOT NULL,
  branch_lat               NUMERIC NOT NULL,
  branch_lng               NUMERIC NOT NULL,

  -- Inputs (snapshot at generation time)
  input_property_ids       UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  input_constraints        JSONB,
  config                   JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Lifecycle status
  status                   TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'optimizing', 'optimized', 'committed', 'cancelled', 'failed')),
  optimized_at             TIMESTAMPTZ,

  -- Output route (ordered list of stops)
  route                    JSONB,

  -- Summary metrics (denormalized so list views don't need to parse route)
  total_drive_minutes      INT,
  total_work_minutes       INT,
  total_buffer_minutes     INT,
  total_day_minutes        INT,
  total_drive_miles        NUMERIC,
  start_time               TEXT,
  end_time                 TEXT,
  return_to_branch         BOOLEAN DEFAULT TRUE,

  -- Constraint satisfaction
  hard_constraint_violations INT DEFAULT 0,
  soft_constraint_violations INT DEFAULT 0,
  optimization_score         NUMERIC,

  -- Optimizer feedback
  optimizer_notes          TEXT,
  excluded_property_ids    UUID[] DEFAULT ARRAY[]::UUID[],
  exclusion_reasons        JSONB,

  -- Audit
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by               TEXT
);

CREATE INDEX IF NOT EXISTS day_schedules_account_client_idx
  ON public.day_schedules(account_id, client_id, scheduled_date DESC);

CREATE INDEX IF NOT EXISTS day_schedules_status_idx
  ON public.day_schedules(status)
  WHERE status IN ('draft', 'optimizing');
