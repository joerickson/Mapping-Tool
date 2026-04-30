-- Phase 4.2 — let the user pick which Crew Strategy option (A/B/C)
-- flows into Bid Pricing instead of always using the analysis's
-- recommended_option.

ALTER TABLE public.account_operational_constraints
  ADD COLUMN IF NOT EXISTS crew_strategy_selected_option text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'aoc_crew_strategy_selected_option_chk'
  ) THEN
    ALTER TABLE public.account_operational_constraints
      ADD CONSTRAINT aoc_crew_strategy_selected_option_chk
      CHECK (
        crew_strategy_selected_option IS NULL
        OR crew_strategy_selected_option IN ('A', 'B', 'C')
      );
  END IF;
END $$;
