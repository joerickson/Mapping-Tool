// Phase 3.5 — categorical palette for branch clusters on the portfolio map.
// 7 colors chosen for distinguishability on a light Mapbox style; index N+1
// cycles back to slot 0 with a small lightness shift in the consumer if
// users ever exceed 7 branches (rare).
export const BRANCH_PALETTE = [
  '#2563eb', // blue
  '#ea580c', // orange
  '#16a34a', // green
  '#dc2626', // red
  '#7c3aed', // purple
  '#a16207', // brown
  '#db2777', // pink
] as const

export function colorForBranchIndex(idx: number): string {
  return BRANCH_PALETTE[((idx % BRANCH_PALETTE.length) + BRANCH_PALETTE.length) % BRANCH_PALETTE.length]
}

// Risk colors, kept here so the map can switch palettes via toggle.
export function colorForRiskScore(score: number | null | undefined): string {
  if (score == null) return '#9ca3af'
  if (score >= 6) return '#dc2626'
  if (score >= 3) return '#f97316'
  if (score >= 1) return '#facc15'
  return '#22c55e'
}
