# Move a Client to a Different Account — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin relocate one client — with all of its data and history — from its current account to another account, atomically.

**Architecture:** An atomic Postgres function re-stamps `account_id` across the client's ~20 `client_id`-scoped tables in one transaction and writes an audit row; a thin admin-only serverless endpoint calls it, maps a name collision to HTTP 409, and does a post-commit straggler check; a client-detail UI action drives it with inline rename on collision.

**Tech Stack:** TypeScript (strict, ESM), Vercel serverless functions (`@vercel/node`), Supabase (Postgres, service-role client), React 18 + Radix UI, Vite. Tests are `npx tsx` scripts.

**Spec:** `docs/superpowers/specs/2026-11-06-move-client-across-accounts-design.md`

## Global Constraints

- ESM imports with `.js` extensions on relative paths.
- All Supabase access via `createAdminClient()` from `api/_lib/supabase.js`.
- TypeScript strict mode; run `npx tsc --noEmit` after every code change (must exit 0).
- `clients` PK is `id`; `service_locations` PK is `id`. Child tables are filtered by `client_id` (never a `*_id` guess). When in doubt query `information_schema`.
- Supabase migration workflow (CLAUDE.md): `supabase migration new <name>`, edit SQL, **show the SQL to the user**, then `supabase db push`, verify with `supabase migration list`, commit the migration file. NEVER `supabase db reset` or `supabase db pull`. Because this migration defines a data-modifying function, confirm the SQL with the user before pushing.
- Admin gate: reuse `requireAdmin(req)` from `api/_lib/auth-roles.js` (throws `{statusCode, message}`).
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Review Focus

- **Move to the account the client is already in** → function no-ops and endpoint returns 200 with `moved: false` (Task 1/2 tests).
- **Nonexistent target account id** → 400 `invalid_target_account`, nothing changed (Task 2 test).
- **`new_name` provided but it ALSO collides in the target account** → still 409 `name_conflict` (Task 2 test).
- **Non-admin / unauthenticated caller** → 403 / 401, nothing changed (Task 2 test).
- **Subject is a combined client, or is a member of a combined client in another account** → move succeeds; membership (by id) still resolves (Task 2 test).

---

### Task 1: Migration — `move_client_to_account` function + `client_account_moves` audit table

**Files:**
- Create: `supabase/migrations/<timestamp>_move_client_to_account.sql` (via `supabase migration new move_client_to_account`)

**Interfaces:**
- Produces (called by Task 2 via `db.rpc(...)`):
  `move_client_to_account(p_client_id uuid, p_target_account_id uuid, p_new_name text default null, p_moved_by uuid default null) returns jsonb`
  - Returns `{ "moved": bool, "from_account_id": uuid, "to_account_id": uuid, "final_name": text, "row_counts": { "<table>": int, ... } }`.
  - Raises `SQLSTATE 'P0001'` with `MESSAGE 'name_conflict'` and `DETAIL '<colliding name>'` when the effective name collides in the target account.
  - Raises `SQLSTATE 'P0002'` / `MESSAGE 'invalid_target_account'` when the target account does not exist.
- Produces (read by Task 2 straggler check): table `client_account_moves(id uuid pk default gen_random_uuid(), client_id uuid not null, from_account_id uuid, to_account_id uuid not null, old_name text, new_name text, moved_by uuid, moved_at timestamptz not null default now(), row_counts jsonb)`.

- [ ] **Step 1: Generate the migration file** — `supabase migration new move_client_to_account`.

- [ ] **Step 2: Write the SQL** (idempotent; `IF NOT EXISTS` / `CREATE OR REPLACE`). The function body, in order:
  1. `SELECT account_id, name INTO v_from, v_old_name FROM clients WHERE id = p_client_id`; if not found, raise `P0001`/`'client_not_found'`.
  2. If target account missing (`SELECT 1 FROM accounts WHERE id = p_target_account_id`), raise `P0002`/`'invalid_target_account'`.
  3. If `v_from = p_target_account_id`, return `jsonb_build_object('moved', false, ...)` without changes.
  4. `PERFORM pg_advisory_xact_lock(hashtextextended(p_client_id::text, 0))`.
  5. `v_final_name := coalesce(p_new_name, v_old_name)`. If `EXISTS (SELECT 1 FROM clients WHERE account_id = p_target_account_id AND lower(name) = lower(v_final_name))`, raise `P0001`/`'name_conflict'` with `DETAIL = v_final_name`.
  6. `UPDATE clients SET account_id = p_target_account_id, name = v_final_name WHERE id = p_client_id`.
  7. For each child table below, `UPDATE <t> SET account_id = p_target_account_id WHERE client_id = p_client_id` and record `GET DIAGNOSTICS` row count into the `row_counts` object:
     `service_locations, service_offerings, service_location_constraints, service_location_constraint_templates, account_operational_constraints, analysis_scenarios, analysis_chat_messages, portfolio_analyses, routing_templates, day_schedules, manual_trips, overnight_cluster_overrides, crew_vehicles, custom_field_definitions, service_line_pricing_config, property_edit_history, addon_cohort_assignments, upload_batches, schedule_assessments`.
     (Account-wide rows carry `client_id IS NULL`, so this filter correctly leaves them with the account.)
  8. `INSERT INTO client_account_moves (...) VALUES (...)`.
  9. Return the summary jsonb.
  Mark the function `SECURITY DEFINER` only if required to run under the service role; otherwise leave default (the endpoint already uses the service-role client).

- [ ] **Step 3: Re-verify the table list against the live schema.** Run (read-only) in the Supabase SQL editor or via the SDK:
  `SELECT table_name FROM information_schema.columns WHERE column_name='account_id' AND table_schema='public' INTERSECT SELECT table_name FROM information_schema.columns WHERE column_name='client_id' AND table_schema='public';`
  Expected: the set above plus `clients`. If any extra table appears, add it to Step 2's loop (or fail loudly) before pushing.

- [ ] **Step 4: Show the full SQL to the user and get confirmation to push** (required: data-modifying function per Global Constraints).

- [ ] **Step 5: Apply + verify** — `supabase db push`, then `supabase migration list`.
  Expected: new migration shows as applied (local + remote aligned).

- [ ] **Step 6: Commit** the migration file.
```bash
git add supabase/migrations/*_move_client_to_account.sql
git commit -m "feat: add atomic move_client_to_account function + audit table"
```

---

### Task 2: Endpoint — `POST /api/v1/clients/[id]/move`

**Files:**
- Create: `api/v1/clients/[id]/move.ts`
- Test: `tests/integration/move-client.test.ts`

**Interfaces:**
- Consumes: `requireAdmin` from `../../../_lib/auth-roles.js`, `createAdminClient` from `../../../_lib/supabase.js`, and the RPC from Task 1.
- Request: `POST` with body `{ target_account_id: string, new_name?: string }`, query param `id` (client id).
- Responses: `200 { moved, from_account_id, to_account_id, final_name, row_counts, stragglers }`; `409 { error: 'name_conflict', conflicting_name }`; `400 { error: 'invalid_target_account' }`; `403`/`401` from `requireAdmin`; `405` for non-POST.
- Behavior after a successful RPC commit (the "run-when-quiet" straggler check): count rows across the moved tables still carrying `account_id = from_account_id AND client_id = id`; include as `stragglers` (number). Non-zero is surfaced, not an error.

- [ ] **Step 1: Write the failing integration test** `tests/integration/move-client.test.ts` (run with `npx tsx`, pattern per `tests/integration/onboarding.test.ts`: `TEST_BASE_URL`). **Auth note:** this endpoint uses `requireAdmin`, which rejects service-key (`mode: 'service'`) auth — the test must send a real admin user bearer token (`TEST_ADMIN_TOKEN`, `Authorization: Bearer …`), NOT `X-RBM-Service-Key`. Seeding can use the service-role client directly. Assertions (hand-rolled `assert`):
  - Seed: create account A and B, a client under A with ≥1 service_location, ≥1 analysis_scenario, ≥1 upload_batch, and an account-wide `service_offerings` row under A (client_id null).
  - Move client A→B with no `new_name`: expect 200, `moved === true`, `to_account_id === B`.
  - Re-read each seeded child row: `account_id === B`; the account-wide offering under A still has `account_id === A` (did not move).
  - No-op: the client is now in B; moving it again with `target_account_id = B` returns 200 `moved === false`.
  - Collision: create a client named `X` under B; move another client named `X` from A→B with no `new_name` → 409 `name_conflict`, `conflicting_name === 'X'`; retry with `new_name: 'X (moved)'` → 200.
  - Collision persists: `new_name` that also exists under B → 409.
  - Bad target: `target_account_id` = random uuid → 400 `invalid_target_account`.
  - Auth: no token → 401; non-admin token (if `TEST_MEMBER_TOKEN` set) → 403.
  - Combined: a combined client in A whose members live in A and another account → move A→B succeeds and `GET /api/v1/clients/:id` still resolves member SL stats.

- [ ] **Step 2: Run the test, verify it fails** — `npx tsx tests/integration/move-client.test.ts` (with env + local `vercel dev`/`npm run dev` server running). Expected: FAIL (route 404 / handler missing).

- [ ] **Step 3: Implement `api/v1/clients/[id]/move.ts`** — handler: OPTIONS→200; non-POST→405; `await requireAdmin(req)` (catch → `res.status(err.statusCode ?? 403)`); read `id`, `target_account_id`, `new_name`; `db.rpc('move_client_to_account', { p_client_id: id, p_target_account_id: target_account_id, p_new_name: new_name ?? null, p_moved_by: ctx.userId ?? null })`; map a `name_conflict` error (inspect `error.message`/`details`) → 409 with `conflicting_name`; map `invalid_target_account` → 400; on success run the straggler count query and return the summary + `stragglers`.

- [ ] **Step 4: Run the test, verify it passes.** Expected: PASS. Then `npx tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit.**
```bash
git add api/v1/clients/\[id\]/move.ts tests/integration/move-client.test.ts
git commit -m "feat: add admin POST /api/v1/clients/:id/move endpoint"
```

---

### Task 3: UI — "Move to another account" action on the client detail page

**Files:**
- Create: `src/components/client/MoveClientDialog.tsx`
- Modify: `src/pages/clients/ClientDetail.tsx` (add the action, admin-gated)

**Interfaces:**
- Consumes: `useAuth().getToken` (bearer), the Task 2 endpoint, `GET /api/v1/accounts` (target list), `GET /api/v1/me` (`app_user.role` for the admin gate). Reuses `Dialog`, `Select`, `Input`, `FormField`, `Button` from `src/components/ui/*` (same imports as `ClientEditDialog.tsx`).
- `MoveClientDialog` props: `{ open: boolean; onClose: () => void; client: { id: string; name: string; account_id: string }; onMoved?: (toAccountId: string) => void }`.

- [ ] **Step 1: Build `MoveClientDialog.tsx`.** Fetch accounts on open (exclude `client.account_id`) into a `Select`. On confirm, `POST /api/v1/clients/:id/move` with `{ target_account_id }`. On `409 name_conflict`: reveal a "New name for this client in the target account" `Input` (pre-filled with `client.name`, focused) with a short explanation, and resubmit including `new_name`. On success: toast, call `onMoved`, close. Show the plain note: "This client will use the target account's shared service offerings and pricing." Surface a non-zero `stragglers` value as a warning toast advising a re-run.

- [ ] **Step 2: Wire into `ClientDetail.tsx`.** Add a "Move to another account" item near the existing edit action, rendered only when the current user is an admin (`me.app_user.role === 'admin'`). Open `MoveClientDialog`; on `onMoved`, refetch the client so it reflects the new account.

- [ ] **Step 3: Verify compile** — `npx tsc --noEmit` → exit 0.

- [ ] **Step 4: Manual verification** (no component-test harness exists). With the dev server running, open a client detail page as an admin, move the client to another account, confirm it (a) succeeds, (b) prompts for rename on a known name clash and then succeeds, (c) the client now appears under the target account. Optionally drive this with the `webapp-testing` skill (Playwright).

- [ ] **Step 5: Commit.**
```bash
git add src/components/client/MoveClientDialog.tsx src/pages/clients/ClientDetail.tsx
git commit -m "feat: add Move-to-another-account action on client detail"
```

---

## Notes carried from the design

- Properties, portfolios, client_templates, and cycle/route/scheduled-visit tables carry no `account_id` and travel for free — do not touch them.
- Adopting the target account's shared offerings/pricing is intended behavior, not a bug to fix.
- Airtight write-blocking during a move is explicitly out of scope.
