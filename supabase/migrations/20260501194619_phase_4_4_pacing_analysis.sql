-- Phase 4.4 — pacing analysis on routing templates.
-- pacing_analysis: per-crew pair rates + end-workday spread.
-- warnings: structured warnings the cycle UI surfaces (load imbalance,
-- pairing underutilized, etc.). Both are jsonb so the engine can extend
-- the shape without further migrations.
ALTER TABLE public.routing_templates
  ADD COLUMN IF NOT EXISTS pacing_analysis jsonb,
  ADD COLUMN IF NOT EXISTS warnings jsonb NOT NULL DEFAULT '[]'::jsonb;
