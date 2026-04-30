-- Phase 3.6 — Re-scope analysis from account-level to (account_id, client_id) pair.
--
-- All existing tables already have a client_id column (Phase 1/2.5/3); this
-- migration backfills any nulls, enforces NOT NULL, and reshapes
-- account_operational_constraints to use a composite PK. analysis_chat_messages
-- gains a client_id column.
--
-- Backfill strategy: pick the most-common client_id from this account's
-- service_locations; fall back to any client that belongs to the account.
-- Rows that can't be resolved (no clients exist on the account) are deleted —
-- they would be orphans and the new NOT NULL constraint would reject them.
--
-- Idempotency: each step uses IF NOT EXISTS / IF EXISTS so re-running is safe
-- after partial application. The PK swap on account_operational_constraints is
-- guarded by checking the current PK definition before dropping.

-- ============================================================================
-- portfolio_analyses
-- ============================================================================

UPDATE public.portfolio_analyses pa
SET client_id = COALESCE(
  (SELECT sl.client_id
     FROM public.service_locations sl
     WHERE sl.account_id = pa.account_id AND sl.client_id IS NOT NULL
     GROUP BY sl.client_id
     ORDER BY COUNT(*) DESC
     LIMIT 1),
  (SELECT c.id FROM public.clients c WHERE c.account_id = pa.account_id LIMIT 1)
)
WHERE pa.client_id IS NULL;

DELETE FROM public.portfolio_analyses WHERE client_id IS NULL;

ALTER TABLE public.portfolio_analyses
  ALTER COLUMN client_id SET NOT NULL;

DROP INDEX IF EXISTS public.portfolio_analyses_account_module_idx;

CREATE INDEX IF NOT EXISTS portfolio_analyses_account_client_module_idx
  ON public.portfolio_analyses(account_id, client_id, module_key, created_at DESC);

-- ============================================================================
-- account_operational_constraints — composite PK (account_id, client_id)
-- ============================================================================

UPDATE public.account_operational_constraints aoc
SET client_id = COALESCE(
  (SELECT sl.client_id
     FROM public.service_locations sl
     WHERE sl.account_id = aoc.account_id AND sl.client_id IS NOT NULL
     GROUP BY sl.client_id
     ORDER BY COUNT(*) DESC
     LIMIT 1),
  (SELECT c.id FROM public.clients c WHERE c.account_id = aoc.account_id LIMIT 1)
)
WHERE aoc.client_id IS NULL;

DELETE FROM public.account_operational_constraints WHERE client_id IS NULL;

-- Swap PK only if it's currently the single-column form. Re-runs are safe
-- because the second branch sees the composite PK already in place.
DO $$
DECLARE
  pk_cols TEXT;
BEGIN
  SELECT string_agg(a.attname, ',' ORDER BY array_position(i.indkey, a.attnum))
    INTO pk_cols
  FROM pg_index i
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
  WHERE i.indrelid = 'public.account_operational_constraints'::regclass
    AND i.indisprimary;

  IF pk_cols = 'account_id' THEN
    ALTER TABLE public.account_operational_constraints
      DROP CONSTRAINT account_operational_constraints_pkey;
    ALTER TABLE public.account_operational_constraints
      ALTER COLUMN client_id SET NOT NULL;
    ALTER TABLE public.account_operational_constraints
      ADD CONSTRAINT account_operational_constraints_pkey
      PRIMARY KEY (account_id, client_id);
  END IF;
END $$;

-- (the existing account_operational_constraints_client_idx from Phase 2.5
-- covers the (client_id) lookup pattern, no new index needed.)

-- ============================================================================
-- analysis_scenarios
-- ============================================================================

UPDATE public.analysis_scenarios s
SET client_id = COALESCE(
  (SELECT sl.client_id
     FROM public.service_locations sl
     WHERE sl.account_id = s.account_id AND sl.client_id IS NOT NULL
     GROUP BY sl.client_id
     ORDER BY COUNT(*) DESC
     LIMIT 1),
  (SELECT c.id FROM public.clients c WHERE c.account_id = s.account_id LIMIT 1)
)
WHERE s.client_id IS NULL;

DELETE FROM public.analysis_scenarios WHERE client_id IS NULL;

ALTER TABLE public.analysis_scenarios
  ALTER COLUMN client_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS analysis_scenarios_account_client_idx
  ON public.analysis_scenarios(account_id, client_id, created_at DESC);

-- ============================================================================
-- analysis_chat_messages — add client_id, backfill, NOT NULL
-- ============================================================================

ALTER TABLE public.analysis_chat_messages
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE;

UPDATE public.analysis_chat_messages cm
SET client_id = COALESCE(
  (SELECT sl.client_id
     FROM public.service_locations sl
     WHERE sl.account_id = cm.account_id AND sl.client_id IS NOT NULL
     GROUP BY sl.client_id
     ORDER BY COUNT(*) DESC
     LIMIT 1),
  (SELECT c.id FROM public.clients c WHERE c.account_id = cm.account_id LIMIT 1)
)
WHERE cm.client_id IS NULL;

DELETE FROM public.analysis_chat_messages WHERE client_id IS NULL;

ALTER TABLE public.analysis_chat_messages
  ALTER COLUMN client_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS analysis_chat_messages_account_client_idx
  ON public.analysis_chat_messages(account_id, client_id, created_at);
