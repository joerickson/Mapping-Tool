// Fuzzy-match raw addresses (from CSV uploads) to existing
// service_locations. We use a normalized-token Jaccard similarity
// against `properties.address_line1` (city/state/zip optional).
//
// Output: each input gets a best-match SL id + confidence score, or
// null if below the auto-match threshold. The wizard surfaces all
// rows below AUTO_THRESHOLD in a manual review tray.

import type { SupabaseClient } from '@supabase/supabase-js'

const AUTO_THRESHOLD = 0.7 // lowered from 0.85 — abbreviated addresses
                            // ("123 Main St" vs "123 Main Street, Phoenix")
                            // routinely scored ~0.7 and got dumped into the
                            // review tray for no good reason.
const REVIEW_THRESHOLD = 0.45 // below this we don't bother surfacing as a
                              // candidate — too noisy.

interface Candidate {
  sl_id: string
  property_id: string
  address_line1: string
  city: string | null
  state: string | null
  postal_code: string | null
}

function normalize(s: string): string[] {
  return s
    .toLowerCase()
    // Strip punctuation, collapse whitespace.
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Common address abbreviations canonicalized.
    .replace(/\bstreet\b/g, 'st')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\bboulevard\b/g, 'blvd')
    .replace(/\broad\b/g, 'rd')
    .replace(/\bdrive\b/g, 'dr')
    .replace(/\bcourt\b/g, 'ct')
    .replace(/\blane\b/g, 'ln')
    .replace(/\bplace\b/g, 'pl')
    .replace(/\bparkway\b/g, 'pkwy')
    .replace(/\bnorth\b/g, 'n')
    .replace(/\bsouth\b/g, 's')
    .replace(/\beast\b/g, 'e')
    .replace(/\bwest\b/g, 'w')
    .split(' ')
    .filter(Boolean)
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  let inter = 0
  for (const t of setA) if (setB.has(t)) inter++
  const union = setA.size + setB.size - inter
  return union === 0 ? 0 : inter / union
}

export interface MatchInput {
  row_id: string
  raw_address: string
  // Optional disambiguators. When present, they boost the match score
  // for candidates whose property has the same city/state/zip — turning
  // ambiguous "123 Main St" into a confident match.
  raw_city?: string | null
  raw_state?: string | null
  raw_postal_code?: string | null
}

export interface MatchOutput {
  row_id: string
  matched_sl_id: string | null
  confidence: number | null
  match_status: 'auto' | 'unmatched' | 'pending'
  candidates: Array<{ sl_id: string; address_line1: string; score: number }>
}

export async function matchAddresses(
  db: SupabaseClient,
  clientIds: string[], // resolved member ids if combined
  inputs: MatchInput[]
): Promise<MatchOutput[]> {
  if (inputs.length === 0) return []
  // Pull all SLs (and their property addresses) for the resolved
  // client set. Page to avoid the 1000-row cap.
  const candidates: Candidate[] = []
  const PAGE = 1000
  for (let p = 0; p < 50; p++) {
    const { data } = await db
      .from('service_locations')
      .select(
        'id, property_id, property:properties(address_line1, city, state, postal_code)'
      )
      .in('client_id', clientIds)
      .range(p * PAGE, p * PAGE + PAGE - 1)
    const batch = data ?? []
    for (const r of batch as any[]) {
      if (!r.property) continue
      candidates.push({
        sl_id: r.id,
        property_id: r.property_id,
        address_line1: r.property.address_line1 ?? '',
        city: r.property.city ?? null,
        state: r.property.state ?? null,
        postal_code: r.property.postal_code ?? null,
      })
    }
    if (batch.length < PAGE) break
  }
  // Tokenize candidate addresses once.
  const candTokens = candidates.map((c) => ({
    cand: c,
    tokens: normalize(c.address_line1),
  }))
  // Score each input against every candidate; keep top 3. When the
  // input row has city / state / zip, boost the score for candidates
  // whose property's city/state/zip matches — turns "123 Main St"
  // into a confident match when 5 SLs share the street name but only
  // one is in Phoenix.
  const out: MatchOutput[] = []
  const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
  for (const inp of inputs) {
    const inputTokens = normalize(inp.raw_address)
    const inCity = norm(inp.raw_city)
    const inState = norm(inp.raw_state)
    const inZip = norm(inp.raw_postal_code).replace(/\D/g, '').slice(0, 5)
    const scored: Array<{ sl_id: string; address: string; score: number }> = []
    for (const ct of candTokens) {
      let score = jaccard(inputTokens, ct.tokens)
      // City exact match: +0.10. State match: +0.05. Zip match: +0.10.
      // Mismatches penalize lightly so we don't over-confident on a
      // street collision when city/state are wrong.
      const cCity = norm(ct.cand.city)
      const cState = norm(ct.cand.state)
      const cZip = norm(ct.cand.postal_code).replace(/\D/g, '').slice(0, 5)
      if (inCity && cCity) score += inCity === cCity ? 0.1 : -0.05
      if (inState && cState) score += inState === cState ? 0.05 : -0.05
      if (inZip && cZip) score += inZip === cZip ? 0.1 : -0.03
      // Clamp to [0, 1].
      score = Math.max(0, Math.min(1, score))
      if (score >= REVIEW_THRESHOLD) {
        scored.push({ sl_id: ct.cand.sl_id, address: ct.cand.address_line1, score })
      }
    }
    scored.sort((a, b) => b.score - a.score)
    const top = scored.slice(0, 3)
    const best = top[0]
    if (best && best.score >= AUTO_THRESHOLD) {
      out.push({
        row_id: inp.row_id,
        matched_sl_id: best.sl_id,
        confidence: Math.round(best.score * 100) / 100,
        match_status: 'auto',
        candidates: top.map((t) => ({
          sl_id: t.sl_id,
          address_line1: t.address,
          score: Math.round(t.score * 100) / 100,
        })),
      })
    } else if (best) {
      // Not confident enough — leave as 'pending' (review tray).
      out.push({
        row_id: inp.row_id,
        matched_sl_id: null,
        confidence: Math.round(best.score * 100) / 100,
        match_status: 'pending',
        candidates: top.map((t) => ({
          sl_id: t.sl_id,
          address_line1: t.address,
          score: Math.round(t.score * 100) / 100,
        })),
      })
    } else {
      out.push({
        row_id: inp.row_id,
        matched_sl_id: null,
        confidence: null,
        match_status: 'unmatched',
        candidates: [],
      })
    }
  }
  return out
}
