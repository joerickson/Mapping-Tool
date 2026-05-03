-- Schedule assessment & enhancer.
--
-- Operators upload N historical schedule CSVs (one per cycle), the
-- system fuzzy-matches addresses to existing service_locations,
-- detects implicit constraints across the aggregate, generates an
-- optimized baseline, and lets the user iterate to a hybrid that can
-- be saved as a routing template.
--
-- This migration lands the data model. PR2 + PR3 add baseline /
-- diff / detection logic on top.

CREATE TABLE IF NOT EXISTS public.schedule_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- Lifecycle: draft → matched → baseline → finalized.
  -- 'archived' is a soft-delete that keeps the row around for audit.
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','matched','baseline','finalized','archived')),
  -- When set, the diff dashboard compares the uploaded schedule against
  -- this template's most recent generated cycle. Otherwise the
  -- baseline is a fresh engine run from current constraints.
  baseline_template_id uuid REFERENCES public.routing_templates(id) ON DELETE SET NULL,
  -- Per-property iteration choices. Keys are service_location_id;
  -- each entry is { source: 'current'|'optimized', date?, crew_name? }.
  hybrid_overrides jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS schedule_assessments_account_idx
  ON public.schedule_assessments(account_id);
CREATE INDEX IF NOT EXISTS schedule_assessments_client_idx
  ON public.schedule_assessments(client_id);

-- One row per uploaded CSV. Filename + parsed row count for the UI;
-- the actual rows live in schedule_assessment_rows.
CREATE TABLE IF NOT EXISTS public.schedule_assessment_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.schedule_assessments(id) ON DELETE CASCADE,
  filename text NOT NULL,
  cycle_label text, -- operator-supplied label like "2024 cycle" or "Last spring"
  row_count int NOT NULL DEFAULT 0,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS schedule_assessment_files_assessment_idx
  ON public.schedule_assessment_files(assessment_id);

-- Parsed rows from uploaded CSVs. Keep raw + matched columns side by
-- side so the operator can review unmatched rows and re-pick.
CREATE TABLE IF NOT EXISTS public.schedule_assessment_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.schedule_assessments(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES public.schedule_assessment_files(id) ON DELETE CASCADE,
  raw_address text NOT NULL,
  raw_scheduled_date date,
  raw_crew_name text,
  matched_service_location_id uuid REFERENCES public.service_locations(id) ON DELETE SET NULL,
  match_confidence numeric, -- 0..1; null when unmatched
  match_status text NOT NULL DEFAULT 'pending'
    CHECK (match_status IN ('pending','auto','manual','unmatched','skipped')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS schedule_assessment_rows_assessment_idx
  ON public.schedule_assessment_rows(assessment_id);
CREATE INDEX IF NOT EXISTS schedule_assessment_rows_match_status_idx
  ON public.schedule_assessment_rows(assessment_id, match_status);
CREATE INDEX IF NOT EXISTS schedule_assessment_rows_sl_idx
  ON public.schedule_assessment_rows(matched_service_location_id);

-- Detected / accepted constraints. Populated by PR3's detection
-- layer; status starts at 'detected', operator accepts/rejects.
CREATE TABLE IF NOT EXISTS public.schedule_assessment_constraints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.schedule_assessments(id) ON DELETE CASCADE,
  detection_type text NOT NULL,
  scope_type text NOT NULL CHECK (scope_type IN ('global','crew','property','pair')),
  scope_ids uuid[],
  pattern jsonb,
  confidence numeric,
  status text NOT NULL DEFAULT 'detected'
    CHECK (status IN ('detected','accepted','rejected','edited')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS schedule_assessment_constraints_assessment_idx
  ON public.schedule_assessment_constraints(assessment_id);
