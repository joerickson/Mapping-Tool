-- Phase 4.2 — manual trip planner.
--
-- The overnight calculator auto-clusters properties using a drive-time
-- threshold. The trip planner gives the user manual control: they
-- group specific properties into a named trip, the system computes
-- nights + miles + hotel cost for that trip, and Bid Pricing can use
-- the manual trips as overrides instead of the auto-clusters.

CREATE TABLE IF NOT EXISTS public.manual_trips (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name            text NOT NULL,
  branch_name     text NOT NULL,
  property_ids    uuid[] NOT NULL DEFAULT '{}',
  visits_per_year int  NOT NULL DEFAULT 1,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS manual_trips_account_client_idx
  ON public.manual_trips(account_id, client_id);
