-- Phase 4.2 — let the user override crew counts directly per branch
-- instead of accepting whatever Option A/B/C dictates. Shape:
--   { "Frisco TX": 2, "Sugar Land TX": 1, "Albuquerque NM": 1 }
-- Keys are branch names matching selected_branches[].name. Total
-- crew_count = sum of values. Null / empty object = no override.

ALTER TABLE public.account_operational_constraints
  ADD COLUMN IF NOT EXISTS crew_count_per_branch_override jsonb;
