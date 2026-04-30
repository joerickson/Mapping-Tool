-- Phase 4e — recurring annual schedules with auto-generation,
-- preflight checks, and side-by-side comparison.

-- ── Visit-level completion tracking ───────────────────────────────────
ALTER TABLE public.scheduled_visits
  ADD COLUMN IF NOT EXISTS completed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by  text;

-- ── Cycle-level completion tracking ───────────────────────────────────
ALTER TABLE public.cycle_instances
  ADD COLUMN IF NOT EXISTS completion_pct                numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS visits_completed_count        int     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS visits_total_count            int     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completion_last_calculated_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_generation_triggered_at  timestamptz,
  ADD COLUMN IF NOT EXISTS next_cycle_id                 uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cycle_instances_next_cycle_fk'
  ) THEN
    ALTER TABLE public.cycle_instances
      ADD CONSTRAINT cycle_instances_next_cycle_fk
      FOREIGN KEY (next_cycle_id) REFERENCES public.cycle_instances(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Auto-generation config on routing_templates ───────────────────────
ALTER TABLE public.routing_templates
  ADD COLUMN IF NOT EXISTS auto_generate_enabled              boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_generate_at_completion_pct    numeric DEFAULT 80,
  ADD COLUMN IF NOT EXISTS auto_generate_lead_days            int     DEFAULT 14;

-- ── cycle_preflight_checks ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cycle_preflight_checks (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_instance_id     uuid NOT NULL REFERENCES public.cycle_instances(id) ON DELETE CASCADE,
  template_id           uuid NOT NULL REFERENCES public.routing_templates(id) ON DELETE CASCADE,

  check_type            text NOT NULL,
  severity              text NOT NULL,

  affected_count        int,
  affected_entity_type  text,
  affected_entity_ids   uuid[] DEFAULT ARRAY[]::uuid[],

  description           text NOT NULL,
  suggested_action      text,

  acknowledged          boolean DEFAULT false,
  acknowledged_at       timestamptz,
  acknowledged_by       text,

  created_at            timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cpc_check_type_chk') THEN
    ALTER TABLE public.cycle_preflight_checks
      ADD CONSTRAINT cpc_check_type_chk CHECK (check_type IN (
        'holiday_in_work_week',
        'blackout_date_conflict',
        'seasonal_window_violation',
        'property_added_since_template',
        'property_removed_since_template',
        'capacity_overflow',
        'cohort_year_transition',
        'cohort_unassigned',
        'extended_idle_period',
        'cycle_starts_during_holiday'
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cpc_severity_chk') THEN
    ALTER TABLE public.cycle_preflight_checks
      ADD CONSTRAINT cpc_severity_chk CHECK (severity IN ('blocking', 'warning', 'info'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS cpc_cycle_idx
  ON public.cycle_preflight_checks(cycle_instance_id, severity, acknowledged);
