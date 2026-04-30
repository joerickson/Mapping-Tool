-- Phase 4d follow-up: dedupe the typo-variant service_offerings for JLL.
--
-- "Project Clean & Power Wash"  (id fd8e87c7…)  → 0 SLs   — DELETE
-- "Project Clean & Powerwashing" (id e4a17081…) → 499 SLs — KEEP
--   Transfer routing config (parent / 0.5yr / routed) onto the kept row
--   first so the user's manual configuration isn't lost.
--
-- "Upholstery, HIgh Clean Stage" (id 549e8463…) → 0 SLs   — DELETE
-- "Upholstery, High Clean Stage" (id 5c500028…) → 473 SLs — KEEP
--   Both have identical routing flags (standalone / not routed); nothing
--   to transfer. The user can configure this as an addon via the UI when
--   ready — neither row got the addon role from the Phase 4d backfill
--   because the spec's ILIKE 'Upholstery' is exact-match and these names
--   don't match.

-- 1. Transfer routing config from soon-to-be-deleted Project Clean row
--    to the kept row.
UPDATE public.service_offerings
   SET is_routed            = TRUE,
       offering_role        = 'parent',
       visit_interval_years = 0.5
 WHERE id = 'e4a17081-7691-4ab5-8dcd-849634c41a0f';

-- 2. Delete the two unused typo-variant rows.
DELETE FROM public.service_offerings
 WHERE id IN (
   'fd8e87c7-8184-4f22-b806-ebc3798f6145',
   '549e8463-08cc-4e0f-9174-fcfef4cf7b99'
 );
