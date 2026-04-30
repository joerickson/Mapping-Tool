-- Dedupe service_offerings for the JLL Property Reserve client.
--
-- Setup created paired rows: one with account_id=NULL, one scoped to the
-- account. The account-scoped row is the "real" one (has all the
-- service_locations pointing at it); the null-account row is leftover
-- from an earlier import and unused.
--
-- Verified pre-migration that each null-account ID has 0 FK references
-- in service_locations, so deletion is safe — no FK repointing needed.
--
-- Targeted deletes only — leaves typo variants ("Project Clean & Power
-- Wash" vs "Project Clean & Powerwashing", "Upholstery, High Clean Stage"
-- vs "Upholstery, HIgh Clean Stage") for the user to resolve manually
-- since they have actually-different names. UNIQUE constraint deferred
-- until those are reconciled.

DELETE FROM public.service_offerings
WHERE id IN (
  '439a4f86-ea0d-48f9-b3d0-8ea9777bb445',  -- Mission Home Housekeeping (null acct)
  '985c9ffb-c362-45ae-af36-bf89ac2163b0',  -- S and I Housekeeping (null acct)
  '45a05809-9055-4c13-8345-9a3d664839f4'   -- S and I Project Clean (null acct)
);
