-- Phase 4.1 — overnight cost transparency.
--
-- Per-cluster overrides for overnight calculation. cluster_id is a
-- stable sha256 prefix of the sorted property_ids in the cluster, so
-- the same set of properties produces the same id across re-runs and
-- the override survives. If properties move between clusters, the id
-- shifts and the override is treated as stale.

CREATE TABLE IF NOT EXISTS public.overnight_cluster_overrides (
  id                                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                        uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  client_id                         uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  cluster_id                        text NOT NULL,
  cluster_label                     text NOT NULL,

  nights_per_trip_override          int,
  trips_per_year_override           int,
  cost_per_night_override           numeric,
  per_diem_per_night_override       numeric,

  skip_overnight                    boolean NOT NULL DEFAULT false,
  skip_overnight_reason             text,

  override_reason                   text,
  overridden_by                     text,
  overridden_at                     timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oco_unique_per_cluster') THEN
    ALTER TABLE public.overnight_cluster_overrides
      ADD CONSTRAINT oco_unique_per_cluster
      UNIQUE (account_id, client_id, cluster_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oco_nights_chk') THEN
    ALTER TABLE public.overnight_cluster_overrides
      ADD CONSTRAINT oco_nights_chk
      CHECK (nights_per_trip_override IS NULL OR nights_per_trip_override >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oco_trips_chk') THEN
    ALTER TABLE public.overnight_cluster_overrides
      ADD CONSTRAINT oco_trips_chk
      CHECK (trips_per_year_override IS NULL OR trips_per_year_override >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oco_cost_per_night_chk') THEN
    ALTER TABLE public.overnight_cluster_overrides
      ADD CONSTRAINT oco_cost_per_night_chk
      CHECK (cost_per_night_override IS NULL OR cost_per_night_override >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oco_per_diem_chk') THEN
    ALTER TABLE public.overnight_cluster_overrides
      ADD CONSTRAINT oco_per_diem_chk
      CHECK (per_diem_per_night_override IS NULL OR per_diem_per_night_override >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS oco_account_client_idx
  ON public.overnight_cluster_overrides(account_id, client_id);
