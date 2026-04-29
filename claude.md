# PortfolioIQ Repo Rules for Claude Code

## Database column references — CRITICAL
- properties table primary key is `id` (uuid), NOT `property_id`
- service_locations table primary key is `id` (uuid), NOT `service_location_id`
- upload_staged_rows DOES have property_id and service_location_id as tracking columns — these are correct
- service_locations.property_id IS a real FK column — correct
- When in doubt, query information_schema before writing column names

## After every code change
- Run `npx tsc --noEmit` to verify TypeScript compiles before committing
- Output a diff showing what changed and confirm no remaining occurrences of incorrect column references

## Conventions
- ESM imports with .js extensions on relative paths
- All Supabase access via createAdminClient() from _lib/supabase.js
- TypeScript strict mode

## Don't claim a fix is complete unless
- The actual offending code has been changed (not just nearby lines)
- TypeScript compiles
- A diff is shown confirming the change

- ## Supabase migrations

The Supabase CLI is installed and linked to project ref `efpjlesawuymmafwgkrm` (Mapping Tool).

Workflow for schema changes:
1. Generate migration file: `supabase migration new descriptive_snake_case_name`
2. Edit the SQL in `supabase/migrations/{timestamp}_name.sql`
3. Show the SQL to the user for review
4. Apply directly to remote: `supabase db push`
5. Verify success with: `supabase migration list`

Rules:
- Always use `IF NOT EXISTS` and `IF EXISTS` for idempotency
- NEVER run `supabase db reset` (destructive)
- NEVER run `supabase db pull` (requires Docker, not installed)
- For DROP TABLE / DROP COLUMN / data-modifying migrations, confirm with user before pushing
- After push, commit the migration file to git
