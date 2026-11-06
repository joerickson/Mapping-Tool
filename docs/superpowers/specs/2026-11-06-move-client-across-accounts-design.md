# Move a client to a different account

Status: draft for approval
Date: 2026-11-06
Author: Jon Erickson (with Claude)

## Intent and why

Clients currently live permanently under the account they were created in.
In practice a client sometimes needs to belong to a *different* account —
reorganization, a client that was filed under the wrong account, or
consolidating related work. Today the only way to do that is to recreate the
client and re-import everything, losing all analysis history.

We want a single action that relocates a client — with all of its data and
history intact — from one account to another. This is the first half of a
larger goal ("move a client, then combine clients into a consolidated view").
Combining is **out of scope** for this work; the user will test the existing
combine feature separately once move exists.

## Goals

- Relocate one client from its current account to a chosen target account.
- Everything that belongs to the client travels with it: service locations,
  properties, analyses, scenarios, chat history, routing templates, day
  schedules, constraint templates, pricing config, upload batches, edit
  history — the client is fully intact under the new account.
- The relocation is **atomic**: it either fully succeeds or fully rolls back.
  The data is never split across two accounts.
- When the target account already has a client with the same name, the user
  is prompted to rename the moving client inline and the move then proceeds.

## Non-goals

- Combining/merging clients into a consolidated client (separate, already
  partially exists; tested separately).
- Moving an *account* wholesale, or moving individual properties/service
  locations between clients (property-level reassignment already exists).
- Any destructive operation. Nothing is deleted or copied-then-orphaned;
  rows are re-stamped in place.

## Anti-goals (what would make this a failure even if it "works")

- A move that leaves some of a client's rows pointing at the old account and
  some at the new one (split-brain). Partial moves are worse than no feature.
- Silently overwriting / colliding with an existing client in the target
  account.
- A move any logged-in member can trigger on any client without authority.

## Key constraints discovered in the codebase

1. **`account_id` is denormalized across ~19 tables.** A client is not a
   single row. Every table below carries its own `account_id` and must be
   re-stamped. All of them also carry `client_id`, so each can be updated
   with a `WHERE client_id = <moved client>` filter:

   `clients` (the row itself), `service_locations`, `service_offerings`,
   `service_location_constraints`, `service_location_constraint_templates`,
   `account_operational_constraints`, `analysis_scenarios`,
   `analysis_chat_messages`, `portfolio_analyses`, `routing_templates`,
   `day_schedules`, `manual_trips`, `overnight_cluster_overrides`,
   `crew_vehicles`, `custom_field_definitions`, `service_line_pricing_config`,
   `property_edit_history`, `addon_cohort_assignments`, `upload_batches`,
   `schedule_assessments`.

   (The authoritative list is derived from the migrations; the builder must
   re-verify against `information_schema` at implementation time — see
   "Left to the builder". New tables with an `account_id` column added after
   this date must be added to the move.)

2. **`properties` are the exception** — keyed by `client_id` only, no
   `account_id`. They travel for free; no update needed.

3. **Client names are unique per account** (`idx_clients_account_name` on
   `clients(account_id, LOWER(name))`). This is the collision the inline
   rename resolves. The legacy `idx_clients_name_no_account` only applies to
   null-account clients and is not relevant here.

4. **Account-level (non-client) rows must not move.** A few tables
   (`account_operational_constraints`, `service_offerings`) can hold
   account-wide rows with `client_id IS NULL`. The `WHERE client_id = X`
   filter leaves those untouched, which is correct — they belong to the
   account, not the client.

   **Behavioral consequence (accepted — decided with user):** some loaders
   resolve config with an account-wide OR-join, e.g.
   `api/_lib/analysis/service-offerings.ts` (`loadAccountOfferings`) pulls
   "the account's account-level offerings PLUS the client's own", and
   `api/v1/clients/[id]/service-line-pricing.ts` does
   `account_id IS NULL OR account_id = <account>`. After a move these resolve
   against the **target** account. **Decision: the client adopts the target
   account's shared catalog** — we do NOT copy the source account's
   account-wide offerings/pricing onto the client. Analyses may therefore
   recompute differently after a move; this is intended (the client is now
   operated by the target account). The move UI should state this plainly so
   it isn't a surprise. (Operational constraints are unaffected:
   `loadConstraints` keys on both `account_id` AND `client_id`, so the
   client's own rows re-stamp and travel.)

5. **Combined clients are safe.** A combined client references its members by
   id in `member_client_ids` (jsonb), and membership already spans accounts.
   Moving a member does not change its id, so combined clients that include
   the moved client keep resolving correctly. A combined client may itself be
   moved (only its nav "host" account changes).

## The how (decided)

### Database — atomic move via a Postgres function

A migration adds `move_client_to_account(p_client_id uuid,
p_target_account_id uuid, p_new_name text default null)`. A function body runs
in a single transaction, giving us atomicity for free.

Behavior:
- Validate the client exists; validate the target account exists; no-op guard
  if already in the target account.
- Take a transaction-level advisory lock on the client id to prevent
  concurrent moves.
- Resolve the effective name: `p_new_name` if given, else the current name.
  Check for a case-insensitive collision against clients in the target
  account. On collision, `RAISE EXCEPTION` with a distinct SQLSTATE / message
  the API maps to HTTP 409 `name_conflict`.
- `UPDATE clients SET account_id = target (, name = p_new_name) WHERE id = X`.
- For each child table, `UPDATE ... SET account_id = target WHERE client_id = X`.
- Return a small JSON summary (target account, final name, per-table row
  counts) for logging/observability.

Idempotency: migration uses `CREATE OR REPLACE FUNCTION`.

**Audit record (decided with user):** the same migration adds a
`client_account_moves` table (`id`, `client_id`, `from_account_id`,
`to_account_id`, `old_name`, `new_name`, `moved_by` (app_user id), `moved_at`,
`row_counts` jsonb). The function inserts one row per successful move. This is
the durable "who moved what, when" trail.

**Post-move verification (decided with user — "run when quiet"):** we do NOT
block concurrent writes during a move. The move is an infrequent admin action
and is expected to be run when the client isn't being actively processed. To
catch the rare straggler (a row written with the old `account_id` mid-move),
the function re-counts, immediately after the updates, any rows still carrying
the source `account_id` for that `client_id` across the moved tables and
includes that count in its return payload; a non-zero count surfaces as a
warning in the API response and the UI (so an admin can re-run). Airtight
write-blocking is explicitly out of scope.

### API — admin-only endpoint

`POST /api/v1/clients/[id]/move`
Body: `{ target_account_id: string, new_name?: string }`
- Gated by `requireAdmin` (reuses `api/_lib/auth-roles.ts`).
- Calls the RPC via `createAdminClient()`.
- Maps the collision exception to `409 { error: 'name_conflict',
  conflicting_name }`; other failures to `400/500` with the DB message.
- On success returns the RPC summary.

### UI — a "Move to another account" action

Entry point: `ClientDetail.tsx` (an action in the client's header/menu),
reusing the dialog pattern already used by `ClientEditDialog.tsx`.

Flow:
1. Dialog loads the list of accounts (excluding the current one) into a
   Select.
2. User picks a target account and confirms.
3. If the API returns `409 name_conflict`, the dialog reveals a "New name"
   field (pre-filled with the current name, focused) explaining the target
   account already has a client with that name, and the user resubmits with
   `new_name`.
4. On success: toast, and refresh/redirect so the client now appears under
   the target account.

Permissions in UI: the action is only shown to admins (mirrors the API gate).

## Left to the builder

- Re-verify the exact set of `account_id`-bearing, `client_id`-scoped tables
  against `information_schema.columns` at build time (migrations are the
  starting list, not the final authority), and fail loudly if an unexpected
  table with `account_id` + `client_id` is found that the function doesn't
  handle.
- Exact SQLSTATE used for the name-conflict signal and its mapping in the
  endpoint.
- Whether to also surface the move action from `ClientsList.tsx` / account
  overview, or `ClientDetail.tsx` only (default: `ClientDetail.tsx` only).
- Copy/wording in the dialog.
- Tests: an integration test that seeds a client with rows in several child
  tables, moves it, and asserts (a) every row's `account_id` is the target,
  (b) account-level `client_id IS NULL` rows did not move, (c) a colliding
  name without `new_name` returns 409, (d) with `new_name` it succeeds.

## Decisions resolved with the user

- **Name collision in target account:** prompt the user to rename the client
  inline, then proceed (not block, not auto-suffix).
- **Account-wide offerings/pricing:** the client adopts the target account's
  shared catalog; the source account's account-wide config is not copied.
- **Concurrency:** run-when-quiet; no write-blocking. A post-move verification
  count flags any stragglers.
- **Audit:** persist a `client_account_moves` record on each move.

## Decisions settled by the builder (minor; noted for the record)

- **Any client status is movable** (active / prospect / churned). A move is a
  reorganization action, not a lifecycle change; no status gate.
- **A client that is a member of a combined client in another account may be
  moved.** Combined membership is by client id (account-independent), so the
  combined client keeps resolving the member after the move. No special guard.
