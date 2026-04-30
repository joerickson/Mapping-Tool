-- Phase 4 — service line bid pricing structure.
--
-- Each (account, client, service_offering) row carries its pricing
-- model and rate, plus a billable_sqft_pct that handles "we only bill
-- 92% of measured sqft per the contract" cases. Per-line target
-- margin override; null falls through to the account-level default.

CREATE TABLE IF NOT EXISTS public.service_line_pricing_config (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                    uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  client_id                     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  service_offering_id           uuid NOT NULL REFERENCES public.service_offerings(id) ON DELETE CASCADE,

  pricing_model                 text NOT NULL,
  rate_per_sqft_per_visit       numeric,
  rate_per_sqft_per_month       numeric,

  billable_sqft_pct             numeric NOT NULL DEFAULT 100,
  billable_sqft_pct_notes       text,

  target_gross_margin_pct_override  numeric,

  is_active                     boolean NOT NULL DEFAULT true,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'slpc_pricing_model_chk') THEN
    ALTER TABLE public.service_line_pricing_config
      ADD CONSTRAINT slpc_pricing_model_chk
      CHECK (pricing_model IN ('per_visit_blended_sqft', 'per_sqft_monthly'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'slpc_billable_pct_chk') THEN
    ALTER TABLE public.service_line_pricing_config
      ADD CONSTRAINT slpc_billable_pct_chk
      CHECK (billable_sqft_pct >= 0 AND billable_sqft_pct <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'slpc_margin_override_chk') THEN
    ALTER TABLE public.service_line_pricing_config
      ADD CONSTRAINT slpc_margin_override_chk
      CHECK (
        target_gross_margin_pct_override IS NULL
        OR (target_gross_margin_pct_override >= 0 AND target_gross_margin_pct_override <= 100)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'slpc_unique_per_offering') THEN
    ALTER TABLE public.service_line_pricing_config
      ADD CONSTRAINT slpc_unique_per_offering
      UNIQUE (account_id, client_id, service_offering_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS slpc_account_client_idx
  ON public.service_line_pricing_config(account_id, client_id) WHERE is_active = true;

-- Backfill default rates for known offering names. Iterates every
-- (account, client) pair that has at least one service_location and
-- inserts a row per recognised offering. ON CONFLICT skips rows the
-- user already saved.
DO $$
DECLARE
  combo RECORD;
  offering_name_pattern text;
  offering_id uuid;
  default_model text;
  default_visit_rate numeric;
  default_month_rate numeric;
BEGIN
  FOR combo IN
    SELECT DISTINCT account_id, client_id
    FROM public.service_locations
    WHERE account_id IS NOT NULL AND client_id IS NOT NULL
  LOOP
    -- (pattern, model, per-visit rate, per-month rate)
    FOR offering_name_pattern, default_model, default_visit_rate, default_month_rate IN
      VALUES
        ('Project Clean',           'per_visit_blended_sqft', 0.18, NULL),
        ('S&I Project Clean',       'per_visit_blended_sqft', 0.18, NULL),
        ('Upholstery',              'per_visit_blended_sqft', 0.05, NULL),
        ('Recurring Janitorial',    'per_sqft_monthly',       NULL, 0.16),
        ('Mission Home Housekeeping', 'per_sqft_monthly',     NULL, 0.22),
        ('S&I Housekeeping',        'per_sqft_monthly',       NULL, 0.20)
    LOOP
      SELECT id INTO offering_id
      FROM public.service_offerings
      WHERE name ILIKE offering_name_pattern
        AND (account_id IS NULL OR account_id = combo.account_id)
      ORDER BY (account_id IS NOT NULL) DESC, created_at ASC
      LIMIT 1;

      IF offering_id IS NULL THEN CONTINUE; END IF;

      INSERT INTO public.service_line_pricing_config (
        account_id, client_id, service_offering_id, pricing_model,
        rate_per_sqft_per_visit, rate_per_sqft_per_month, billable_sqft_pct
      ) VALUES (
        combo.account_id, combo.client_id, offering_id, default_model,
        default_visit_rate, default_month_rate, 100
      ) ON CONFLICT (account_id, client_id, service_offering_id) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;
