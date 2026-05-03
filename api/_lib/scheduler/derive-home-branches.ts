// Translate operator-supplied per-branch crew counts into a flat array
// of home_branch_indices (length = crew_count). The engine uses this to
// stage every crew at a home location for travel-time math while still
// letting them work anywhere via the global cluster-assignment pass.
//
// Rules:
//  - Per-branch counts are looked up by branch.name (case-insensitive
//    exact match against the keys of crew_count_per_branch_override).
//  - If sum(per_branch) < crew_count, the residual crews are staged at
//    the busiest branch in input order. A small log-only warning would
//    be ideal here, but the engine doesn't have a logger; the staging
//    optimizer (PR2) will catch this case in the UI.
//  - If sum(per_branch) > crew_count, the per-branch counts are scaled
//    down proportionally and rounded to fit. Operator should normally
//    enter sum = crew_count; this is a guard.
//  - If override is null/empty, returns null and the engine falls back
//    to its default heuristic (crew i → branch i, extras to busiest).

export function deriveHomeBranchIndices(
  override: Record<string, number> | null | undefined,
  branches: Array<{ name: string }>,
  crewCount: number
): number[] | null {
  if (!override || branches.length === 0 || crewCount <= 0) return null

  const lowerNameToIdx = new Map<string, number>()
  branches.forEach((b, i) => lowerNameToIdx.set(b.name.toLowerCase(), i))

  // Normalize keys to indices, dropping any keys that don't map.
  const counts: Array<{ idx: number; count: number }> = []
  for (const [key, value] of Object.entries(override)) {
    const idx = lowerNameToIdx.get(key.toLowerCase())
    const n = Math.max(0, Math.floor(Number(value) || 0))
    if (idx == null || n === 0) continue
    counts.push({ idx, count: n })
  }
  if (counts.length === 0) return null

  const totalAssigned = counts.reduce((s, c) => s + c.count, 0)
  if (totalAssigned > crewCount) {
    // Scale down proportionally — large rounding doesn't matter much
    // since the operator should be entering sum = total.
    const scale = crewCount / totalAssigned
    let allocated = 0
    for (const c of counts) {
      c.count = Math.floor(c.count * scale)
      allocated += c.count
    }
    // Top up any rounding shortfall on the largest entries.
    counts.sort((a, b) => b.count - a.count)
    let i = 0
    while (allocated < crewCount && i < counts.length) {
      counts[i].count++
      allocated++
      i++
    }
  }

  // Residuals when sum(per_branch) < crew_count. Distribute them
  // PROPORTIONALLY to the existing per-branch weights (largest-
  // remainder method) instead of dumping every extra at branch 0.
  // Previously this caused a hidden bug: with override = {Albuquerque:
  // 1, Lindon: 4, Phoenix: 2} sum=7 and crew_count=14, the engine put
  // 7 extras at Albuquerque → 8 crews there, then suggestions showed
  // "Albuquerque Crew 1, 2, 3" when the operator only staged 1.
  const residual = crewCount - counts.reduce((s, c) => s + c.count, 0)
  if (residual > 0) {
    const sumExisting = counts.reduce((s, c) => s + c.count, 0)
    if (sumExisting > 0) {
      const fracs = counts.map((c) => ({
        idx: c.idx,
        whole: 0,
        rem: 0,
      }))
      let assigned = 0
      for (let i = 0; i < counts.length; i++) {
        const want = (counts[i].count / sumExisting) * residual
        fracs[i].whole = Math.floor(want)
        fracs[i].rem = want - fracs[i].whole
        assigned += fracs[i].whole
      }
      // Largest-remainder: top up the entries with the biggest
      // fractional parts first.
      const order = [...fracs].sort((a, b) => b.rem - a.rem)
      let r = 0
      while (assigned < residual && r < order.length) {
        order[r].whole++
        assigned++
        r++
      }
      for (let i = 0; i < counts.length; i++) {
        counts[i].count += fracs[i].whole
      }
    }
    // If still under (no existing weights to scale), round-robin across
    // branches so we don't all-pile on branch 0.
    if (counts.reduce((s, c) => s + c.count, 0) < crewCount) {
      const needed = crewCount - counts.reduce((s, c) => s + c.count, 0)
      for (let i = 0; i < needed; i++) {
        const targetIdx = i % branches.length
        // Find existing entry or add a new one.
        const existing = counts.find((c) => c.idx === targetIdx)
        if (existing) existing.count++
        else counts.push({ idx: targetIdx, count: 1 })
      }
    }
  }

  // Build the flat array.
  const result: number[] = []
  for (const c of counts) {
    for (let j = 0; j < c.count; j++) result.push(c.idx)
  }
  return result
}
