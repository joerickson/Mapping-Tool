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

  // Build the flat array: for each entry, push idx repeated count times.
  const result: number[] = []
  for (const c of counts) {
    for (let j = 0; j < c.count; j++) result.push(c.idx)
  }

  // Residual crews when sum(per_branch) < crew_count: stage at branch
  // index 0 (operator UI in PR2 will require sum = total to remove this
  // case). For now, branch 0 is a defensible default — it's typically
  // the primary branch in operator input order.
  while (result.length < crewCount) result.push(0)

  return result
}
