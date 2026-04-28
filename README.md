# RBM Geo — Portfolio Intelligence Platform

React + Vite frontend, Vercel serverless API, Supabase database + auth, Mapbox mapping.

## Setup

1. Copy `.env.local.example` to `.env.local` and fill in values.
2. `npm install`
3. `npm run dev`

## Authentication

Auth is handled by **Supabase Auth**. The app uses email + password sign-in.

### Supabase Email Templates

Email templates (Reset Password, Invite User, Confirm Signup) must be configured manually
in the **Supabase dashboard → Authentication → Email Templates**.

Match the patterns used in RBM CRM for consistency across the tool family.
Custom SMTP via **Resend** should be configured under
**Supabase dashboard → Project Settings → Auth → SMTP Settings**, using the same
Resend credentials as CRM.

Do not hardcode email templates in the codebase.

### Password Reset Flow

The reset password link redirects to `${VITE_APP_URL}/login/update-password?code=<code>`.
The `/login/update-password` page exchanges the PKCE code for a session, then prompts the
user to set a new password.

### Signup

Self-signup is disabled by default. Set `VITE_ALLOW_SIGNUP=true` to enable the `/signup`
page. Otherwise, users must be invited via the Supabase dashboard.

## API Auth

API routes accept two authentication modes:

- **User JWT** — `Authorization: Bearer <supabase-access-token>` header. Verified via
  `supabase.auth.getUser(token)`.
- **Service key** — `X-RBM-Service-Key: <key>` header. Checked against the
  `service_api_keys` table (SHA-256 hash), with `SERVICE_API_KEY` env var as legacy fallback.

## Env Vars

| Variable | Required | Description |
|---|---|---|
| `VITE_APP_URL` | ✓ | Public app URL (used in email redirect links) |
| `VITE_SUPABASE_URL` | ✓ | Supabase project URL (client-side) |
| `VITE_SUPABASE_ANON_KEY` | ✓ | Supabase anon key (client-side) |
| `VITE_MAPBOX_ACCESS_TOKEN` | ✓ | Mapbox public token |
| `VITE_ALLOW_SIGNUP` | | `true` to enable /signup page (default: disabled) |
| `SUPABASE_URL` | ✓ | Supabase project URL (server-side) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | Supabase service role key (server-side) |
| `ANTHROPIC_API_KEY` | ✓ | Anthropic Claude API key |
| `GOOGLE_MAPS_API_KEY` | ✓ | Google Maps API key |
| `REGRID_API_KEY` | | Regrid parcel API key |
| `PARCEL_FALLBACK_THRESHOLD` | | Fallback call alert threshold (default: 50) |
| `SERVICE_API_KEY` | ✓ | Service-to-service API key (legacy fallback) |
| `ADMIN_NOTIFICATION_EMAIL` | ✓ | Email for admin alerts |
| `RESEND_API_KEY` | | Resend API key for transactional email |
| `SMARTY_AUTH_ID` | | Smarty Streets auth ID (Stage 0c address validation) |
| `SMARTY_AUTH_TOKEN` | | Smarty Streets auth token (Stage 0c address validation) |

## Address Scrubbing (Stage 0)

Before geocoding, every uploaded address passes through a local scrub pipeline:

1. **Local scrub** (Stage 0) — always runs, zero API cost. Normalizes country, state, postal code, casing, and street suffixes. Generates a SHA-256 dedupe hash.
2. **Dedup detection** (Stage 0b) — flags exact duplicates within the batch and matches against existing `properties` records.
3. **Smarty validation** (Stage 0c) — optional, runs only if `SMARTY_AUTH_ID` and `SMARTY_AUTH_TOKEN` are set. Verifies US/CA addresses against the Smarty Streets API. MX addresses are skipped (Smarty US/CA tier only).

After Stage 0 completes, the upload redirects to `/upload/{batchId}/review` where you can inspect clean, auto-corrected, needs-review, and duplicate addresses before starting enrichment.
