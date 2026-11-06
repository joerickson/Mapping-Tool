# Client Map Share Link — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public, no-login URL for a single client that renders its properties on a map color-coded by branch (like Smart Analysis), always-current, admin-generated.

**Architecture:** A client-level share token (new columns on `clients`) + an admin generate endpoint + a no-auth public read endpoint that returns the client's properties (combined members resolved) and its committed branches, rendered by the existing `AnalysisMap` on a public page. Mirrors the existing portfolio-share feature but at the client level, admin-gated, never-expiring by default, no financials.

**Tech Stack:** TypeScript (strict, ESM), Vercel serverless (`@vercel/node`), Supabase, React 18 + Mapbox, Vite. Tests are `npx tsx` scripts.

**Spec:** `docs/superpowers/specs/2026-11-06-client-map-share-link-design.md`

## Global Constraints

- ESM imports with `.js` extensions on relative paths; all Supabase access via `createAdminClient()` from `_lib/supabase.js`.
- Run `npx tsc --noEmit` after every code change (exit 0). `clients` PK is `id`.
- Supabase migration workflow (CLAUDE.md): `supabase migration new`, edit SQL, **show the SQL to the user and confirm before `supabase db push`**, verify with `supabase migration list`, commit the migration file. Use `IF NOT EXISTS`. NEVER `db reset`/`db pull`.
- The generate endpoint MUST use `requireAdmin` (from `_lib/auth-roles.js`) — server-side, not just UI gating (it mints a public link).
- The public read endpoint is **no-auth**, must use `createAdminClient()` server-side only (never expose the service key to the client), and must **never** include financial/dollar fields in its payload.
- Combined clients: resolve members for **points** via `resolveClientIdsList` (`_lib/clients/resolve-client-ids.js`); branches come from the combined client's own `selected_branches` (no member union).
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Review Focus

- **Unknown / malformed token** → public endpoint returns 404, never 500 (Task 3 test).
- **Expired token** (only when `share_expires_at` is set) → 410 (Task 3 test).
- **Client with no committed `selected_branches`** → `branches: []`, neutral pins, HTTP 200 (not a 500) (Task 3 test).
- **Combined client** → `points` include every member's properties; `branches` = the combined client's own synced selection (Task 3 test).
- **Non-admin / unauthenticated caller of the generate endpoint** → 403 / 401; no token minted (Task 2 test).

---

### Task 1: Migration — client share-token columns

**Files:**
- Create: `supabase/migrations/<timestamp>_client_share_token.sql` (via `supabase migration new client_share_token`)

**Interfaces:**
- Produces: `clients.share_token text UNIQUE` (nullable) and `clients.share_expires_at timestamptz` (nullable), consumed by Tasks 2 & 3.

- [ ] **Step 1:** `supabase migration new client_share_token`.
- [ ] **Step 2:** Write SQL: `ALTER TABLE clients ADD COLUMN IF NOT EXISTS share_token text;` + `ALTER TABLE clients ADD COLUMN IF NOT EXISTS share_expires_at timestamptz;` + `CREATE UNIQUE INDEX IF NOT EXISTS clients_share_token_key ON clients (share_token) WHERE share_token IS NOT NULL;` (partial unique so many NULLs are allowed).
- [ ] **Step 3:** Show the SQL to the user; confirm before pushing.
- [ ] **Step 4:** `supabase db push`; verify `supabase migration list` (local == remote).
- [ ] **Step 5:** Commit the migration file.

---

### Task 2: Generate endpoint — `POST /api/v1/clients/[id]/share`

**Files:**
- Create: `api/v1/clients/[id]/share.ts`
- Test: `tests/integration/client-share-generate.test.ts`

**Interfaces:**
- Consumes: `requireAdmin` (`../../../_lib/auth-roles.js`), `createAdminClient` (`../../../_lib/supabase.js`), Task 1 columns. Import depth is three `../` (file at `api/v1/clients/[id]/share.ts`); verify against `api/v1/clients/[id]/move.ts`.
- `POST` body `{ expires_at?: string | null }`; query `id`. Returns `200 { share_token, share_expires_at }`. `DELETE` (or `{ revoke: true }`) clears the token → `200 { share_token: null }`.
- Token: `crypto.randomBytes(24).toString('base64url')` (same as `api/v1/portfolios/[id]/share.ts`). `share_expires_at` defaults to `null` (never expires); set only when `expires_at` is provided.

- [ ] **Step 1: Write the failing integration test** (`npx tsx`, pattern per `tests/integration/move-client.test.ts`). AUTH: `requireAdmin` rejects service-key auth — use an admin **user bearer token** (`TEST_ADMIN_TOKEN`). Seed a client via the service-role client. Assert: POST with no body → 200, `share_token` non-empty, `share_expires_at === null`; a second POST reuses-or-rotates per implementation but still returns a usable token; POST with `{expires_at}` sets it; no token / non-admin token → 401 / 403 and `clients.share_token` stays null. WRITTEN-NOT-RUN (needs a live admin token) — mark it so; gate is `npx tsc --noEmit`.
- [ ] **Step 2:** Run `npx tsc --noEmit` → exit 0 (the integration run is deferred).
- [ ] **Step 3: Implement `api/v1/clients/[id]/share.ts`** per the Interfaces: OPTIONS→200; `requireAdmin` (catch → `err.statusCode ?? 403`); POST generates/sets token via `db.from('clients').update({share_token, share_expires_at}).eq('id', id).select('share_token, share_expires_at').single()`; DELETE clears it. 405 otherwise.
- [ ] **Step 4:** `npx tsc --noEmit` → exit 0.
- [ ] **Step 5:** Commit.

---

### Task 3: Public read endpoint — `GET /api/v1/shared-clients/[token]`

**Files:**
- Create: `api/v1/shared-clients/[token].ts`
- Test: `tests/integration/shared-client-read.test.ts`

**Interfaces:**
- Consumes: `createAdminClient`, `resolveClientIdsList` (`../../_lib/clients/resolve-client-ids.js`), Task 1 columns.
- `GET` (no auth). Query `token`. Behavior: look up `clients` by `share_token`; **404** if none; **410** if `share_expires_at` is non-null and in the past. Else resolve members (`resolveClientIdsList(db, [client.id])`), page `service_locations` by `client_id IN members` → `property_id`s, fetch `properties(id, latitude, longitude)` for those ids with non-null lat/lng, and read the client's committed branches from `account_operational_constraints.selected_branches` (scoped by `client.account_id` + `client.id`).
- Returns `200 { client: { name, display_name, brand_color }, points: [{id, lat, lng}], branches: [{name, lat, lng}] }`. **No financial fields** (do not select `risk_score`, cost, mcv, or contract columns — branch coloring doesn't use them). `branches` is `[]` when no selection exists. Each `selected_branches` entry has `{ name, city_state, lat, lng }`; map to `{ name, lat, lng }`.
- (The pagination + member-resolution mirrors `api/v1/properties/index.ts`; a shared helper is optional but not required.)

- [ ] **Step 1: Write the failing integration test** `tests/integration/shared-client-read.test.ts` (`npx tsx`; NO auth header needed — it's a public endpoint). Seed via the service-role client: an account; two member clients each with a geocoded property + service_location; a combined client referencing both, with a `share_token`; an `account_operational_constraints` row on the combined client with one `selected_branches` entry. Assert: GET `/api/v1/shared-clients/<token>` → 200; `points` contains both members' property ids; `branches` has the one branch `{name,lat,lng}`; the payload has NO key matching `/cost|price|mcv|contract|revenue|financial|\$/i`; an unknown token → 404; a token whose client has a past `share_expires_at` → 410; a client with no `selected_branches` → `branches: []` and 200. (This test is RUNNABLE against a live server once Task 1 is applied — label accordingly.)
- [ ] **Step 2:** Run `npx tsc --noEmit` → exit 0.
- [ ] **Step 3: Implement `api/v1/shared-clients/[token].ts`** per Interfaces.
- [ ] **Step 4:** `npx tsc --noEmit` → exit 0.
- [ ] **Step 5:** Commit.

---

### Task 4: Public page + route

**Files:**
- Create: `src/pages/SharedClientMap.tsx`
- Modify: `src/App.tsx` (add `/client-map/:shareToken` in the no-auth routes block, next to `/portfolio/:shareToken`)

**Interfaces:**
- Consumes: Task 3's `GET /api/v1/shared-clients/:token`; the existing `AnalysisMap` (`../components/analysis/AnalysisMap`), `colorForBranchIndex` (`../lib/branch-colors.js`).

- [ ] **Step 1: Build `SharedClientMap.tsx`** — read `:shareToken` from the route, `fetch('/api/v1/shared-clients/'+token)` (no auth header). On 404/410 show a plain "link not found / expired" card (mirror `SharedPortfolio.tsx`). On 200 render a header with `client.display_name ?? client.name` and `<AnalysisMap points={points} branches={branches} colorMode="branch" height={...} />`, plus a branch legend (branch name → `colorForBranchIndex(index)` in the same order passed to the map). No app nav/chrome.
- [ ] **Step 2: Add the route** to `src/App.tsx` in the public (no `AuthGuard`) block: `<Route path="/client-map/:shareToken" element={<SharedClientMapPage />} />`.
- [ ] **Step 3:** `npx tsc --noEmit` → exit 0.
- [ ] **Step 4: Manual verification** (no FE test harness): load `/client-map/<token>` for a seeded client and confirm pins render colored by branch with a legend; an unknown token shows the not-found card. (Optional: `webapp-testing` skill.)
- [ ] **Step 5:** Commit.

---

### Task 5: "Share map" action on the client detail page

**Files:**
- Create: `src/components/client/ClientShareModal.tsx`
- Modify: `src/pages/clients/ClientDetail.tsx` (header action, admin-gated)

**Interfaces:**
- Consumes: Task 2's `POST /api/v1/clients/:id/share`; `useAuth().getToken`; the `Dialog`/`Button`/`Input` ui primitives and the pattern in `src/components/portfolio/ShareLinkModal.tsx`.
- `ClientShareModal` props: `{ open, onClose, client: { id, name, share_token?: string | null } }`.

- [ ] **Step 1: Build `ClientShareModal.tsx`** — modeled on `ShareLinkModal.tsx`: a Generate button → `POST /api/v1/clients/:id/share` (bearer token) → show `${import.meta.env.VITE_APP_URL}/client-map/<token>` with a Copy button and a Regenerate option. (No expiry input required in this iteration; never-expires default.)
- [ ] **Step 2: Wire into `ClientDetail.tsx`** — add a "Share map" header action next to the existing "Move to another account" button, rendered only when `isAdmin && client.account` (reuse the existing `isAdmin` gate). Opens `ClientShareModal`.
- [ ] **Step 3:** `npx tsc --noEmit` → exit 0.
- [ ] **Step 4: Manual verification** — as an admin, open a client, click "Share map", generate, copy the link, open it in a private window, confirm the public map loads.
- [ ] **Step 5:** Commit.

---

## Notes carried from the design

- Never-expire default; optional per-link expiry (no expiry UI required this iteration — the endpoint accepts `expires_at` for later).
- Combined clients: points = all members; branch colors = the combined client's own synced selection (so an unsynced combined client shows neutral pins, matching its in-app Smart Analysis map).
- `VITE_APP_URL` must be set for a correct copied link; `VITE_MAPBOX_ACCESS_TOKEN` powers the public map (both pre-existing).
