// Lightweight k-means on lat/lng points using haversine distance.
// Deterministic with a fixed seed (for caching) and supports locked centroids
// (for when the user pins existing branch locations).
import { haversineMiles, type LatLng } from './haversine.js'

export interface KMeansResult {
  centroids: LatLng[]
  assignments: number[] // index into centroids, length == points.length
  iterations: number
  inertia: number // sum of squared distances to assigned centroid (in miles^2)
}

// Mulberry32 — small, fast, deterministic 32-bit PRNG
function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// k-means++ init for the unlocked centroids. Picks one random point, then each
// subsequent center weighted by squared distance to the nearest existing center.
function kmeansPlusPlusInit(
  points: LatLng[],
  k: number,
  locked: LatLng[],
  rand: () => number
): LatLng[] {
  const centroids: LatLng[] = [...locked]
  if (centroids.length >= k) return centroids.slice(0, k)

  if (centroids.length === 0) {
    // pick a random first point
    const idx = Math.floor(rand() * points.length)
    centroids.push({ ...points[idx] })
  }

  while (centroids.length < k) {
    const distSq = points.map((p) => {
      let min = Infinity
      for (const c of centroids) {
        const d = haversineMiles(p, c)
        const d2 = d * d
        if (d2 < min) min = d2
      }
      return min
    })
    const total = distSq.reduce((a, b) => a + b, 0)
    if (total === 0) {
      // all points coincident — just push another copy
      centroids.push({ ...points[0] })
      continue
    }
    let r = rand() * total
    let pickedIdx = 0
    for (let i = 0; i < distSq.length; i++) {
      r -= distSq[i]
      if (r <= 0) {
        pickedIdx = i
        break
      }
    }
    centroids.push({ ...points[pickedIdx] })
  }
  return centroids
}

export function kmeans(
  points: LatLng[],
  k: number,
  opts: {
    seed?: number
    maxIter?: number
    lockedCentroids?: LatLng[] // first N centroids are not updated
  } = {}
): KMeansResult {
  const seed = opts.seed ?? 42
  const maxIter = opts.maxIter ?? 100
  const locked = opts.lockedCentroids ?? []
  const rand = mulberry32(seed)

  if (k <= 0 || points.length === 0) {
    return { centroids: [], assignments: [], iterations: 0, inertia: 0 }
  }
  const effectiveK = Math.min(k, points.length)

  let centroids = kmeansPlusPlusInit(points, effectiveK, locked, rand)
  const assignments = new Array<number>(points.length).fill(0)
  let iterations = 0

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1
    let changed = false

    // assign
    for (let i = 0; i < points.length; i++) {
      let bestIdx = 0
      let bestDist = Infinity
      for (let c = 0; c < centroids.length; c++) {
        const d = haversineMiles(points[i], centroids[c])
        if (d < bestDist) {
          bestDist = d
          bestIdx = c
        }
      }
      if (assignments[i] !== bestIdx) {
        assignments[i] = bestIdx
        changed = true
      }
    }

    // update (skip locked)
    const sums: { lat: number; lng: number; n: number }[] = centroids.map(() => ({
      lat: 0,
      lng: 0,
      n: 0,
    }))
    for (let i = 0; i < points.length; i++) {
      const a = assignments[i]
      sums[a].lat += points[i].lat
      sums[a].lng += points[i].lng
      sums[a].n += 1
    }
    const next: LatLng[] = centroids.map((c, idx) => {
      if (idx < locked.length) return c // locked
      if (sums[idx].n === 0) return c
      return { lat: sums[idx].lat / sums[idx].n, lng: sums[idx].lng / sums[idx].n }
    })

    centroids = next
    if (!changed) break
  }

  // inertia
  let inertia = 0
  for (let i = 0; i < points.length; i++) {
    const d = haversineMiles(points[i], centroids[assignments[i]])
    inertia += d * d
  }

  return { centroids, assignments, iterations, inertia }
}
