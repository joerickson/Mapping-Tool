// Client-side Supabase is intentionally not used for most data operations.
// All data access goes through /api/* serverless functions that use createAdminClient().
// This file only exports a typed helper for the rare cases where client-side queries are needed
// for public (unauthenticated) views like shared portfolios.

export { } // no client-side supabase instance — use API routes
