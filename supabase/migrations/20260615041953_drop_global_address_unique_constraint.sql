-- Drop the GLOBAL unique constraint on raw address columns.
--
-- Why: properties are intended to be PER-CLIENT. Two different clients may
-- legitimately have the same physical address (see the combined-clients
-- architecture and the comment on properties_client_address_hash_unique).
--
-- A global UNIQUE(address_line1, city, state, postal_code) was added
-- out-of-band in Studio (it exists in no prior migration). It conflicts with
-- the per-client uniqueness model: when an address already exists under
-- another client, the commit pipeline's insert is rejected with
--   duplicate key value violates unique constraint
--   "properties_address_line1_city_state_postal_code_key"
-- and the per-client (client_id, address_hash) recovery path can't find the
-- row, so every staged row is marked permanently failed and retries commit 0.
--
-- Per-client uniqueness remains enforced by the partial unique index
-- properties_client_address_hash_unique ON (client_id, address_hash).

ALTER TABLE public.properties
  DROP CONSTRAINT IF EXISTS properties_address_line1_city_state_postal_code_key;
