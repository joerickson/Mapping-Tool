// Phase 4d — density clustering helper, extracted for reuse across
// overnight calculator (Phase 3.7) and template builder (Phase 4d).
//
// Single-link agglomerative clustering: items within `radiusMiles` of
// each other land in the same cluster. Union-find under the hood.
import { haversineMiles } from '../analysis/haversine.js'

export function densityCluster<T extends { lat: number; lng: number }>(
  items: T[],
  radiusMiles: number
): T[][] {
  if (items.length === 0) return []
  const parent = items.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const d = haversineMiles(items[i], items[j])
      if (d <= radiusMiles) union(i, j)
    }
  }

  const groups = new Map<number, T[]>()
  for (let i = 0; i < items.length; i++) {
    const r = find(i)
    const arr = groups.get(r) ?? []
    arr.push(items[i])
    groups.set(r, arr)
  }
  return Array.from(groups.values())
}

// Group by nearest branch — simple bucket by argmin(haversine).
export function groupByNearestBranch<T extends { lat: number; lng: number }>(
  items: T[],
  branches: Array<{ name: string; lat: number; lng: number }>
): Map<number, T[]> {
  const groups = new Map<number, T[]>()
  if (branches.length === 0) {
    if (items.length > 0) groups.set(0, items)
    return groups
  }
  for (const item of items) {
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < branches.length; i++) {
      const d = haversineMiles(item, branches[i])
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
    const arr = groups.get(bestIdx) ?? []
    arr.push(item)
    groups.set(bestIdx, arr)
  }
  return groups
}
