-- Combined client entity. A combined client is a clients row whose
-- service_locations are aggregated from `member_client_ids` instead of
-- being directly attached. It exists so Smart Analysis, Branch
-- Optimization, scheduler, etc. can treat a multi-client portfolio as a
-- single virtual client.
--
-- Members remain fully usable on their own — a combined client is purely
-- a view across them. SLs and offerings are NOT copied; consumer code
-- resolves a combined client into its members at read time.
--
-- The host account_id (where the combined client appears in nav) is the
-- account of the user creating it. member_client_ids may include clients
-- from any account.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS is_combined boolean NOT NULL DEFAULT false;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS member_client_ids jsonb;

-- Partial index — most clients are not combined, so a partial index is
-- both small and useful for "list combined clients" queries.
CREATE INDEX IF NOT EXISTS clients_is_combined_idx
  ON public.clients(is_combined)
  WHERE is_combined = true;

-- Constraint: combined clients must have a non-empty member_client_ids
-- array; non-combined clients must have it null.
ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_combined_members_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_combined_members_check CHECK (
    (is_combined = false AND member_client_ids IS NULL)
    OR
    (is_combined = true
      AND member_client_ids IS NOT NULL
      AND jsonb_typeof(member_client_ids) = 'array'
      AND jsonb_array_length(member_client_ids) >= 2)
  );
