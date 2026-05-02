-- Phase 4.6 — combined schedules: a routing template can synthesize
-- multiple clients into a single cycle.
--
-- combined_client_ids: NULL = single-client template (existing behavior).
-- Non-null array = the SL pool is the UNION across all listed clients.
-- The template's own client_id field stays set to combined_client_ids[0]
-- (the "base" client whose operational constraints govern; FK satisfied).
--
-- Branch picks for combined templates are stored on the template's
-- existing branches jsonb column; UI builds the union pool from the
-- selected clients' selected_branches and lets the operator trim.
ALTER TABLE public.routing_templates
  ADD COLUMN IF NOT EXISTS combined_client_ids jsonb;

CREATE INDEX IF NOT EXISTS routing_templates_combined_idx
  ON public.routing_templates(account_id)
  WHERE combined_client_ids IS NOT NULL;
