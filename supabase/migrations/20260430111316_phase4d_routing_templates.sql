-- Phase 4d — routing templates with cycle-based multi-day scheduling.
--
-- Adds routing metadata to service_offerings, addon cohort assignments,
-- and the four template/cycle/route tables. The unit of work is the
-- "cycle" (typically 6mo for 2x/yr work). Templates are abstract; cycle
-- instances are calendar realizations. Addons (Upholstery) attach to
-- parent visits via cohort rotation.

-- ── service_offerings extension ───────────────────────────────────────
ALTER TABLE public.service_offerings
  ADD COLUMN IF NOT EXISTS is_routed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS offering_role TEXT DEFAULT 'standalone'
    CHECK (offering_role IN ('standalone', 'parent', 'addon')),
  ADD COLUMN IF NOT EXISTS visit_interval_years NUMERIC,
  ADD COLUMN IF NOT EXISTS attaches_to_offering_ids UUID[] DEFAULT ARRAY[]::UUID[],
  ADD COLUMN IF NOT EXISTS uses_cohort_rotation BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS routing_metadata JSONB DEFAULT '{}'::jsonb;

-- Backfill known RBM offerings. Wrapped in DO so missing tables/columns
-- on a fresh DB don't blow up the whole migration.
DO $$
DECLARE
  project_clean_ids UUID[];
  si_project_clean_ids UUID[];
BEGIN
  UPDATE public.service_offerings
     SET is_routed = FALSE, offering_role = 'standalone'
   WHERE name ILIKE 'Recurring Janitorial'
      OR name ILIKE 'Mission Home Housekeeping'
      OR name ILIKE 'S&I Housekeeping';

  UPDATE public.service_offerings
     SET is_routed = TRUE, offering_role = 'parent', visit_interval_years = 0.5
   WHERE name ILIKE 'Project Clean'
      OR name ILIKE 'S&I Project Clean';

  SELECT array_agg(id) INTO project_clean_ids
    FROM public.service_offerings WHERE name ILIKE 'Project Clean';

  SELECT array_agg(id) INTO si_project_clean_ids
    FROM public.service_offerings WHERE name ILIKE 'S&I Project Clean';

  UPDATE public.service_offerings
     SET is_routed = TRUE,
         offering_role = 'addon',
         visit_interval_years = 3,
         uses_cohort_rotation = TRUE,
         attaches_to_offering_ids =
           COALESCE(project_clean_ids, ARRAY[]::UUID[]) ||
           COALESCE(si_project_clean_ids, ARRAY[]::UUID[])
   WHERE name ILIKE 'Upholstery';
END $$;

-- ── addon cohort assignments ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.addon_cohort_assignments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_location_id  UUID NOT NULL REFERENCES public.service_locations(id) ON DELETE CASCADE,
  service_offering_id  UUID NOT NULL REFERENCES public.service_offerings(id),
  account_id           UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  client_id            UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  cohort_index         INT NOT NULL,
  cohort_total         INT NOT NULL,
  next_due_year        INT NOT NULL,
  last_completed_date  DATE,
  assigned_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by          TEXT DEFAULT 'system_auto',
  assignment_method    TEXT DEFAULT 'auto_balanced'
    CHECK (assignment_method IN ('auto_balanced', 'manual_override', 'imported')),
  UNIQUE (service_location_id, service_offering_id)
);

CREATE INDEX IF NOT EXISTS aca_due_year_idx
  ON public.addon_cohort_assignments(service_offering_id, next_due_year);
CREATE INDEX IF NOT EXISTS aca_service_location_idx
  ON public.addon_cohort_assignments(service_location_id);
CREATE INDEX IF NOT EXISTS aca_account_client_idx
  ON public.addon_cohort_assignments(account_id, client_id);

-- ── routing templates ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.routing_templates (
  id                                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                        UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  client_id                         UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name                              TEXT NOT NULL,
  description                       TEXT,
  routed_service_location_ids       UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  crew_count                        INT NOT NULL,
  branches                          JSONB NOT NULL DEFAULT '[]'::jsonb,
  config                            JSONB NOT NULL DEFAULT '{}'::jsonb,
  planning_mode                     TEXT NOT NULL DEFAULT 'auto'
    CHECK (planning_mode IN ('auto', 'hybrid', 'manual')),

  cycle_length_days                 INT NOT NULL,
  cycle_length_label                TEXT NOT NULL,
  is_custom_cycle_length            BOOLEAN DEFAULT FALSE,

  geographic_clusters               JSONB NOT NULL DEFAULT '[]'::jsonb,
  crew_assignments                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  trips                             JSONB NOT NULL DEFAULT '[]'::jsonb,

  total_visits_per_cycle            INT,
  total_drive_minutes_per_cycle     INT,
  total_work_minutes_per_cycle      INT,
  total_overnight_nights_per_cycle  INT,
  total_drive_miles_per_cycle       NUMERIC,
  total_estimated_cost_per_cycle    NUMERIC,
  total_estimated_cost_per_year     NUMERIC,

  hard_constraint_violations        INT DEFAULT 0,
  soft_constraint_violations        INT DEFAULT 0,
  optimization_score                NUMERIC,
  optimizer_notes                   TEXT,

  total_visits_required_per_cycle   INT,
  unplaced_visits                   JSONB DEFAULT '[]'::jsonb,

  status                            TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'optimizing', 'active', 'archived', 'failed')),

  created_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
  optimized_at                      TIMESTAMPTZ,
  created_by                        TEXT
);

CREATE INDEX IF NOT EXISTS routing_templates_account_client_idx
  ON public.routing_templates(account_id, client_id, status);

-- ── cycle instances ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cycle_instances (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id              UUID NOT NULL REFERENCES public.routing_templates(id) ON DELETE CASCADE,
  cycle_number             INT NOT NULL,
  start_date               DATE NOT NULL,
  end_date                 DATE NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled')),
  cycle_specific_overrides JSONB DEFAULT '{}'::jsonb,
  generated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (template_id, cycle_number)
);

CREATE INDEX IF NOT EXISTS cycle_instances_template_idx
  ON public.cycle_instances(template_id, cycle_number);
CREATE INDEX IF NOT EXISTS cycle_instances_dates_idx
  ON public.cycle_instances(start_date, end_date);

-- ── crew day routes ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crew_day_routes (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_instance_id      UUID NOT NULL REFERENCES public.cycle_instances(id) ON DELETE CASCADE,
  template_id            UUID NOT NULL REFERENCES public.routing_templates(id) ON DELETE CASCADE,
  trip_id                TEXT NOT NULL,
  crew_index             INT NOT NULL,
  crew_label             TEXT NOT NULL,
  scheduled_date         DATE NOT NULL,
  day_type               TEXT NOT NULL CHECK (day_type IN ('local', 'overnight', 'travel', 'rest')),
  start_location         JSONB NOT NULL,
  end_location           JSONB,
  route                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_drive_minutes    INT,
  total_work_minutes     INT,
  total_buffer_minutes   INT,
  total_day_minutes      INT,
  total_drive_miles      NUMERIC,
  trip_day_number        INT,
  trip_total_days        INT,
  constraint_violations  JSONB DEFAULT '[]'::jsonb,
  is_manually_edited     BOOLEAN DEFAULT FALSE,
  manually_edited_at     TIMESTAMPTZ,
  manually_edited_by     TEXT,
  cycle_specific_only    BOOLEAN DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crew_day_routes_cycle_idx
  ON public.crew_day_routes(cycle_instance_id, scheduled_date, crew_index);
CREATE INDEX IF NOT EXISTS crew_day_routes_template_trip_idx
  ON public.crew_day_routes(template_id, trip_id);

-- ── scheduled visits ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scheduled_visits (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_instance_id        UUID NOT NULL REFERENCES public.cycle_instances(id) ON DELETE CASCADE,
  template_id              UUID NOT NULL REFERENCES public.routing_templates(id) ON DELETE CASCADE,
  service_location_id      UUID NOT NULL REFERENCES public.service_locations(id),
  property_id              UUID NOT NULL REFERENCES public.properties(id),
  parent_offering_id       UUID REFERENCES public.service_offerings(id),
  attached_addons          JSONB DEFAULT '[]'::jsonb,
  visit_number_in_cycle    INT NOT NULL,
  crew_day_route_id        UUID REFERENCES public.crew_day_routes(id) ON DELETE SET NULL,
  scheduled_date           DATE,
  arrival_time             TEXT,
  departure_time           TEXT,
  sequence_in_day          INT,
  hours_per_visit_base     NUMERIC,
  hours_per_visit_total    NUMERIC,
  status                   TEXT NOT NULL CHECK (status IN ('placed', 'unplaced', 'completed', 'cancelled')),
  unplaced_reason          TEXT,
  completed_at             TIMESTAMPTZ,
  is_locked                BOOLEAN DEFAULT FALSE,
  locked_at                TIMESTAMPTZ,
  locked_by                TEXT,
  cycle_specific_only      BOOLEAN DEFAULT FALSE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scheduled_visits_cycle_idx
  ON public.scheduled_visits(cycle_instance_id, status, scheduled_date);
CREATE INDEX IF NOT EXISTS scheduled_visits_service_location_idx
  ON public.scheduled_visits(service_location_id);
