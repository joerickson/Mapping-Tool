# Public share link for a client's map (color-coded by branch)

Status: draft for approval
Date: 2026-11-06
Author: Jon Erickson (with Claude)

## Intent and why

Today the only way to share mapped properties publicly (no login) is to build
a **portfolio** by hand on the Map page, then share that portfolio. People
want to share a **client's** map directly — the same view they see in Smart
Analysis, color-coded by recommended branch — without first assembling a
portfolio. This adds a one-click "Share map" link at the client level.

## Goals

- A **public, no-login URL** for a single client that renders that client's
  properties on a map, **color-coded by recommended branch with a legend**,
  matching the Smart Analysis map (`AnalysisMap`).
- **Always current**: each time the link is opened it reflects the client's
  current properties and its current committed branch selection — not a
  snapshot taken at share time. (For a *combined* client the "committed
  selection" is the one produced by its "Sync from members" action, exactly
  as the in-app Smart Analysis map shows it — see the combined-client note
  under branches.)
- For a **combined client**, show all members' properties (reuse the
  member-resolution just added to the properties path).
- Generated and managed by an **admin** from the **client detail page**,
  mirroring the existing "Move to another account" action.

## Non-goals

- No dollar figures / financials on the public page — map + branch
  coloring/legend + property addresses only. (The portfolio share has a
  financials toggle; the client link deliberately omits it.)
- Not replacing the portfolio share link — both coexist.
- No editing/interactivity for the public viewer beyond pan/zoom and
  per-pin address popups (same as `AnalysisMap`).
- No per-recipient access control or analytics in this iteration.

## Anti-goals (failure even if it "works")

- A public link that exposes financial figures or any admin-only data.
- A link that shows a stale snapshot after the client's properties/branches
  change (defeats "always current").
- A combined client's link showing nothing (the bug we just fixed) — the
  public endpoint MUST resolve members.

## What the shared view needs (grounded in the code)

`AnalysisMap` (`src/components/analysis/AnalysisMap.tsx`) already renders the
Smart Analysis map and computes each property's branch color **client-side**
(nearest-branch, haversine) using `colorForBranchIndex` from
`src/lib/branch-colors.ts`. Its props:
- `points: AnalysisMapPoint[]` — `{ id, lat, lng, risk_score? }`
- `branches?: AnalysisMapBranch[]` — `{ name, lat, lng, population?, property_count?, utilization_pct? }`
- `colorMode: 'branch'`

So the public endpoint only needs to return `points` and `branches`; no
per-property branch field is required.

Data sources:
- **points** = the client's properties with non-null lat/lng. Resolve
  combined clients to members (same as `/api/v1/properties`), then map to
  `{ id, lat, lng, risk_score }`.
- **branches** = the client's committed selection, stored in
  `account_operational_constraints.selected_branches` (scoped by
  `account_id` + `client_id`; see `.../select-branches.ts`). Map each to
  `{ name, lat, lng }`. If there is no committed selection, return an empty
  branches array and the map renders neutral single-color pins (acceptable
  degradation).
  - **Combined clients — decided:** read the *combined client's own*
    `selected_branches` row (NOT a live union of members' selections). This
    is exactly what the in-app Smart Analysis map shows for a combined
    client, which is the stated goal ("like Smart Analysis"). A combined
    client's branch row is populated by its "Sync from members" action
    (`sync-combined.ts`), so its share link colors reflect the last sync; an
    unsynced combined client shows neutral pins (same as its in-app map).
    Resolving a live union across members is explicitly out of scope — if
    wanted later it's a separate enhancement. (Member resolution still
    applies to **points** — all members' properties appear.)

## The how (decided)

### Share token — mirror the portfolio pattern

A small migration adds share columns to `clients`:
- `share_token text UNIQUE` (nullable), `share_expires_at timestamptz` (nullable).
(The portfolio feature stores the same two fields; mirroring keeps the
public-read + expiry logic consistent.)

### API

- **Generate (admin):** `POST /api/v1/clients/[id]/share` — `requireAdmin`
  (server-side admin enforcement; do NOT mirror the portfolio endpoint's
  `authenticateRequest`, which would let any logged-in user mint a public
  no-login link);
  if the client has no `share_token`, create one (crypto-random, URL-safe);
  `share_expires_at` defaults to NULL (never expires); an optional
  `{ expires_at }` in the body sets one; returns `{ share_token, share_expires_at }`.
  A `DELETE` on the same route (or `{ revoke: true }`) clears the token.
  Mirrors `POST /api/v1/portfolios/[id]/share`.
- **Public read (no auth):** `GET /api/v1/shared-clients/[token]` — looks up
  the client by `share_token`; 404 if none; 410 if `share_expires_at` is
  past (mirror the portfolio 410). Resolves combined members. Returns
  `{ client: { name, display_name, brand_color }, points, branches }` —
  **no financial fields**. Uses `createAdminClient()` server-side (never
  exposes the service key).

### Public page

- Route `/client-map/:shareToken` added to the **public (no-auth)** block in
  `src/App.tsx` (next to `/portfolio/:shareToken`).
- New `src/pages/SharedClientMap.tsx`: fetches `GET /api/v1/shared-clients/:token`,
  renders a header with the client name and a `<AnalysisMap points branches
  colorMode="branch" />` plus a branch legend (branch name → `colorForBranchIndex`),
  and a simple expired/not-found state. No app chrome / nav (public).

### UI action

- On `src/pages/clients/ClientDetail.tsx`, add a **"Share map"** header action
  (icon + label), gated like the Move action (`isAdmin && client.account`).
- It opens a modal (reuse the pattern of
  `src/components/portfolio/ShareLinkModal.tsx`): Generate → show
  `${VITE_APP_URL}/client-map/<token>` with a Copy button and a Regenerate
  option; optional expiry.

## Decisions resolved with the user

- Always-current (not a snapshot).
- No financials on the public page.
- Admin-created, from the client detail page.
- Combined clients show all members' properties.
- Branch coloring mirrors the Smart Analysis map.

## Decisions settled by the builder (minor)

- Share state stored as `clients.share_token` + `clients.share_expires_at`
  (mirrors portfolios) rather than a new table.
- Public page route `/client-map/:shareToken`; public JSON endpoint
  `/api/v1/shared-clients/[token]`.
- Branch legend derives colors from `colorForBranchIndex(index)` in the same
  branch order the map uses, so legend and pins agree.
- Combined-client branch coloring uses the combined client's own synced
  `selected_branches` (matches Smart Analysis); no live member-union. (See
  branches note above.)
- The generate endpoint enforces `requireAdmin` server-side (not just UI
  gating), since it mints a public link.

## Decisions resolved with the user (continued)

- **Link expiry default: never expire.** A generated link has
  `share_expires_at = NULL` by default (public read never 410s on expiry).
  The admin may optionally set an expiry per link; when set, the public
  endpoint returns 410 past it. (This differs from the portfolio share
  endpoint, which hard-codes 90 days — the client link intentionally does
  not.)

## Left to the builder

- Confirm the exact shape of `selected_branches` rows (name/lat/lng keys) at
  implementation time against `select-branches.ts` and the analysis payload.
- Token generation details (length, alphabet) — reuse whatever the portfolio
  share endpoint uses for consistency.
- Whether to also surface "Share map" from the Smart Analysis page header
  (default: client detail page only).
- Tests: a public-endpoint integration test (combined client returns members'
  points; expired token → 410; no-selection → empty branches; no financial
  fields present in the payload).

## Dependencies / gotchas

- The share URL uses `VITE_APP_URL`; if unset in the environment the copied
  link is malformed (pre-existing gotcha shared with the portfolio share).
- The public page renders Mapbox with `VITE_MAPBOX_ACCESS_TOKEN` (already a
  client-exposed token used by the app's maps).
