-- Fix client name uniqueness for multi-account model.
-- The old global unique index prevented different accounts from having
-- clients with the same name. Replace it with:
--   - A partial index for legacy clients with no account (preserves old behavior)
--   - The existing per-account scoped index handles clients with an account_id
DROP INDEX IF EXISTS idx_clients_name_lower;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_name_no_account
  ON clients(LOWER(name))
  WHERE account_id IS NULL;
