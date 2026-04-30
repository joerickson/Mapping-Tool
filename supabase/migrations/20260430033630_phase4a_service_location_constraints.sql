-- Phase 4a: Service-location constraints.
--
-- Each row is one constraint attached to a service_location (e.g. "no service
-- on Sundays", "blackout dates Dec 24–26", "must coordinate with on-site
-- contact"). Constraints are typed via constraint_type, with type-specific
-- config validated in the API layer (api/_lib/analysis/constraint-validators.ts).
--
-- Enforcement is either 'hard' (must satisfy or schedule fails) or 'soft'
-- (preference — penalty in the scheduler's objective).
--
-- account_id + client_id are denormalized so tenant scoping doesn't require
-- a join through service_locations on every read.

CREATE TABLE IF NOT EXISTS public.service_location_constraints (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_location_id  UUID NOT NULL REFERENCES public.service_locations(id) ON DELETE CASCADE,
  account_id           UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  client_id            UUID REFERENCES public.clients(id) ON DELETE CASCADE,

  constraint_type      TEXT NOT NULL,
  enforcement          TEXT NOT NULL CHECK (enforcement IN ('hard', 'soft')),
  config               JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes                TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by           TEXT
);

CREATE INDEX IF NOT EXISTS service_location_constraints_sl_idx
  ON public.service_location_constraints(service_location_id);

CREATE INDEX IF NOT EXISTS service_location_constraints_tenant_idx
  ON public.service_location_constraints(account_id, client_id);

CREATE INDEX IF NOT EXISTS service_location_constraints_type_idx
  ON public.service_location_constraints(constraint_type);

-- Saved bundles of constraints that can be applied to many service locations
-- in one operation (e.g. "Standard retail M–F 8a–6p"). The constraints[] is
-- an array of { constraint_type, enforcement, config, notes? } — the same
-- shape that's persisted in service_location_constraints rows.

CREATE TABLE IF NOT EXISTS public.service_location_constraint_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  client_id    UUID REFERENCES public.clients(id) ON DELETE CASCADE,

  name         TEXT NOT NULL,
  description  TEXT,
  constraints  JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   TEXT
);

CREATE INDEX IF NOT EXISTS service_location_constraint_templates_tenant_idx
  ON public.service_location_constraint_templates(account_id, client_id);

CREATE UNIQUE INDEX IF NOT EXISTS service_location_constraint_templates_name_unique
  ON public.service_location_constraint_templates(account_id, client_id, name);
