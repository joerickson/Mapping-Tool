-- Phase 3: Synthesizer + Scenario Sliders + Chat
-- The portfolio_analyses CHECK constraint already includes 'synthesis' (Phase 1),
-- so synthesis rows persist into the existing table. This migration adds the
-- scenarios table and the chat-thread table.

-- Saved scenarios — named what-if snapshots
CREATE TABLE IF NOT EXISTS public.analysis_scenarios (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  client_id       UUID REFERENCES public.clients(id),
  name            TEXT NOT NULL,
  description     TEXT,

  -- Snapshot of operational_constraints at scenario creation time
  constraints_snapshot JSONB NOT NULL,

  -- Override deltas applied on top of constraints
  -- e.g. { "hourly_loaded_labor_cost": 30.80, "fuel_cost_per_mile": 0.20 }
  overrides       JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Cached module results when this scenario was computed
  module_results  JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Synthesis text computed for this scenario
  synthesis_summary TEXT,

  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      TEXT
);

CREATE INDEX IF NOT EXISTS analysis_scenarios_account_idx
  ON public.analysis_scenarios(account_id, created_at DESC);

-- Persistent chat thread per account
CREATE TABLE IF NOT EXISTS public.analysis_chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content     TEXT NOT NULL,
  -- For assistant messages: tool calls, tool results, scenario refs
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analysis_chat_messages_account_idx
  ON public.analysis_chat_messages(account_id, created_at);
