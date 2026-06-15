# Inline editor for commit-failed upload rows

**Date:** 2026-06-14
**Status:** Approved, pending implementation plan
**Branch:** `fix/upload-address-constraint-and-row-editor`

## Background

Property uploads stage rows into `upload_staged_rows`, then a commit step
(`api/uploads/[batchId]/commit.ts`) inserts `properties` + `service_locations`.
When a row passes validation but fails at insert time, it is recorded as a
**commit failure** (`summary_stats.commit_failures` + `commit_failure_count`)
and surfaced on the Upload Summary page as an amber banner with a "Retry
commit" button. Today the user can only retry verbatim or download a CSV of
*validation*-invalid rows — there is no way to correct a commit-failed row's
data and re-commit it.

This feature was prompted by a batch where 321/328 rows failed to commit. That
specific failure was a database constraint bug (fixed separately in migration
`20260615041953_drop_global_address_unique_constraint.sql`); editing rows would
not have fixed it. The editor is therefore for **genuine bad-data** commit
failures, and must always show the per-row failure reason so structural
failures remain obvious.

## Scope

In scope:
- Editing and re-committing rows that **failed during commit** (passed
  validation, errored on insert).

Out of scope (explicitly decided):
- Editing **validation-invalid** rows (the "Download Errors CSV" path). Those
  never entered the commit pipeline and would need re-validation.
- Unifying the Deno edge-function normalization with the Node copy (noted as a
  follow-up).

## Decisions

- **Editor scope:** commit failures only.
- **Re-validation on edit:** auto re-run address normalization and recompute
  `dedupe_hash` on save, so edited addresses dedupe consistently with the
  original import.
- **Re-commit UX:** a single "Save & re-commit" action (save edits, then call
  the existing commit endpoint, then refresh).

## Data source

`summary_stats.commit_failures` is capped at 50 entries while `failure_count`
can be far larger, so the editor must NOT rely on the stored list to enumerate
failed rows. Instead, query `upload_staged_rows` for the batch where:

- `outcome IN ('valid', 'corrected', 'duplicate_existing')`, AND
- `service_location_id IS NULL` (i.e. not yet committed).

This captures every committable row that has not landed. Per-row failure
reasons are merged in from the `commit_failures` array when an entry exists for
that `staged_row_id`.

## API endpoints

All under `api/uploads/[batchId]/`, authenticated via the existing
`authenticateRequest`, and account-scoped to the batch (verify
`batch.account_id` matches the caller), matching the existing endpoints.

### `GET /api/uploads/[batchId]/failed-rows`
Returns:
```jsonc
[
  {
    "id": "<staged_row_id>",
    "sheet_name": "…",
    "row_index": 12,
    "property_data": { "address_line1": "…", "city": "…", "state": "…",
                       "postal_code": "…", "address_line2": null },
    "service_location_data": { "display_name": "…", "suite_or_floor": null,
                               "serviceable_sqft": null },
    "service_offering_id": "<uuid|null>",
    "reason": "<failure reason or null>"
  }
]
```

### `POST /api/uploads/[batchId]/update-row`
Body: `{ row_id, property_data, service_location_data }`.

Behavior:
1. Load the staged row; 404 if not found or not in this batch.
2. Validate required property fields: `address_line1`, `city`, `state`
   non-empty → 400 otherwise.
3. Re-run `normalizeAddress()` on the property fields and recompute
   `computeDedupeHash()` (see shared module).
4. Update the staged row's `property_data` (normalized),
   `service_location_data`, and `dedupe_hash`.
5. Return the updated row. Does **not** commit.

### Re-commit
Reuse the existing `POST /api/uploads/[batchId]/commit`. It already skips rows
with a `service_location_id` and re-attempts the rest, so edited rows are
picked up with no commit-side changes.

## Shared normalization module — `api/_lib/address.ts`

Extract two pure functions that **exactly replicate** the logic in
`supabase/functions/process-upload-batch/index.ts`:

- `normalizeAddress({ address_line1, address_line2, city, state, postal_code,
  country })` → normalized fields (state → 2-letter code, country alias → code,
  postal formatting).
- `computeDedupeHash({ address_line1, city, state, postal_code })` → SHA-256 hex
  over `addr1|city|state|postal.slice(0,5)`, each field `.toLowerCase().trim()
  .replace(/\s+/g, ' ')`. Use Node `crypto.createHash('sha256')`.

**Parity is critical:** the recomputed hash must equal the edge function's for
the same input, or edited rows will not dedupe against existing properties.
The edge function applies state/postal normalization *before* hashing — replicate
that ordering. The Deno edge function keeps its own copy for now.

## UI

Extract the amber failure block out of `src/pages/UploadSummary.tsx` (currently
~333 lines) into a focused component `src/components/upload/FailedRowsEditor.tsx`,
styled after the existing inline editor in `src/pages/admin/Uploads.tsx`.

- **Collapsed state:** "{n} rows failed to commit", a **Review & fix** button,
  and the existing plain **Retry commit** button (kept).
- **Expanded state:** an editable table with columns — `address_line1`,
  `address_line2`, `city`, `state`, `postal_code`, `display_name`,
  `suite_or_floor`, `serviceable_sqft` — each row showing its failure reason.
- **Save & re-commit:** POST each changed row to `update-row`, then call
  `commit`, then reload the summary stats. Rows that still fail reappear with
  their new reason.

## Error handling

- `update-row`: 400 on missing required fields / malformed body; 404 on unknown
  row or batch mismatch.
- `failed-rows`: 404 on unknown batch; empty array when nothing is pending.
- Re-commit failures are non-fatal — the row stays pending and its updated
  reason is shown on refresh.

## Testing

- `npx tsc --noEmit` must pass (repo rule).
- Hash-parity test for `computeDedupeHash` asserting the Node output equals a
  known edge-function hash for a sample address (add to the existing test runner
  if one is present; otherwise a standalone script under `scripts/`).
- Manual verification: run the app, open a batch with commit failures, edit a
  row, Save & re-commit, confirm it lands.

## Files

New:
- `api/uploads/[batchId]/failed-rows.ts`
- `api/uploads/[batchId]/update-row.ts`
- `api/_lib/address.ts`
- `src/components/upload/FailedRowsEditor.tsx`

Modified:
- `src/pages/UploadSummary.tsx` (use the new component)

Already done (separate commit):
- `supabase/migrations/20260615041953_drop_global_address_unique_constraint.sql`
