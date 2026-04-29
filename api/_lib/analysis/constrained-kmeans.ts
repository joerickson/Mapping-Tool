// Population-constrained k-means: pick K cluster centers from a fixed list of
// real US cities (each with a known population, lat/lng) such that each
// property is assigned to its nearest selected city, and total drive cost is
// minimized.
//
// Why not pure k-means? Unconstrained centroids can land in low-population
// areas where you can't recruit a 30-person crew. This variant restricts the
// center search to cities meeting a min_population threshold and (optionally)
// a state_filter, then does a greedy + local-search optimization.
//
// Algorithm:
//   1. Filter eligible cities by min/max population, state, and a bounding
//      box around the property set + 20% margin.
//   2. Seed locked branches as the first K_locked centers (always included).
//   3. Greedy: for each remaining slot, pick the eligible city that most
//      reduces the total weighted drive cost when added.
//   4. Local search: try swapping each non-locked selected city with each
//      eligible non-selected city; accept any swap that lowers total cost.
//      Stop when an iteration produces no improvement.
import citiesData from '../data/us_cities.json' with { type: 'json' }
import { haversineMiles, type LatLng } from './haversine.js'

export interface City {
  city: string
  state: string
  state_id: string
  lat: number
  lng: number
  population: number
}

export interface ConstrainedKMeansProperty {
  id: string
  lat: number
  lng: number
  visits_per_year: number
}

export interface ConstrainedKMeansOptions {
  k: number
  properties: ConstrainedKMeansProperty[]
  min_population: number
  max_population?: number | null
  state_filter?: string[] | null
  locked_branches?: City[]
  drive_speed_mph: number
  max_iterations?: number
  bbox_margin_pct?: number // default 0.2 (20%)
}

export interface ConstrainedKMeansResult {
  selected_cities: City[]
  // property_id → index into selected_cities
  assignments: Record<string, number>
  total_drive_distance_miles: number
  total_drive_hours: number
  total_drive_cost_proxy: number
  iterations: number
  converged: boolean
  eligible_city_count: number
}

const ALL_CITIES: City[] = (citiesData as any).cities as City[]

export function getCitiesDataset(): City[] {
  return ALL_CITIES
}

// Find the city in the dataset closest to a given lat/lng (no population
// filter). Used to label unconstrained k-means centroids with the nearest
// real city for the "what would pure k-means have suggested" reference.
export function nearestCity(lat: number, lng: number): City | null {
  if (ALL_CITIES.length === 0) return null
  let best = ALL_CITIES[0]
  let bestDist = haversineMiles({ lat, lng }, { lat: best.lat, lng: best.lng })
  for (let i = 1; i < ALL_CITIES.length; i++) {
    const d = haversineMiles({ lat, lng }, { lat: ALL_CITIES[i].lat, lng: ALL_CITIES[i].lng })
    if (d < bestDist) {
      bestDist = d
      best = ALL_CITIES[i]
    }
  }
  return best
}

export function populationBand(pop: number): 'small' | 'medium' | 'large' | 'major' {
  if (pop < 100_000) return 'small'
  if (pop < 500_000) return 'medium'
  if (pop < 1_000_000) return 'large'
  return 'major'
}

export function constrainedKMeans(opts: ConstrainedKMeansOptions): ConstrainedKMeansResult {
  const {
    k,
    properties,
    min_population,
    max_population,
    state_filter,
    locked_branches = [],
    max_iterations = 100,
    bbox_margin_pct = 0.2,
  } = opts

  if (k <= 0 || properties.length === 0) {
    return {
      selected_cities: [],
      assignments: {},
      total_drive_distance_miles: 0,
      total_drive_hours: 0,
      total_drive_cost_proxy: 0,
      iterations: 0,
      converged: true,
      eligible_city_count: 0,
    }
  }

  // ── Filter eligible cities ──────────────────────────────────────────────
  // 1. population window
  // 2. optional state filter
  // 3. bounding box (latitudes/longitudes of the property set, expanded)
  const lats = properties.map((p) => p.lat)
  const lngs = properties.map((p) => p.lng)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const latPad = (maxLat - minLat) * bbox_margin_pct + 0.5
  const lngPad = (maxLng - minLng) * bbox_margin_pct + 0.5
  const stateSet = state_filter?.length ? new Set(state_filter.map((s) => s.toUpperCase())) : null

  const eligible: City[] = ALL_CITIES.filter((c) => {
    if (c.population < min_population) return false
    if (max_population != null && c.population > max_population) return false
    if (stateSet && !stateSet.has(c.state_id.toUpperCase())) return false
    if (c.lat < minLat - latPad || c.lat > maxLat + latPad) return false
    if (c.lng < minLng - lngPad || c.lng > maxLng + lngPad) return false
    return true
  })

  // Always include locked branches in the candidate pool — they may or may
  // not meet the population threshold but the user explicitly pinned them.
  // Compare-by-coords to avoid double-listing if a locked branch is also in
  // the dataset.
  const isCloseEnough = (a: City, b: City) =>
    Math.abs(a.lat - b.lat) < 0.005 && Math.abs(a.lng - b.lng) < 0.005
  const candidates: City[] = [...eligible]
  for (const lb of locked_branches) {
    if (!candidates.some((c) => isCloseEnough(c, lb))) candidates.push(lb)
  }

  // ── Helper: total weighted drive cost given a set of centers ───────────
  // weighted by visits_per_year so frequent properties carry more weight.
  function totalCost(centers: City[]): {
    cost: number
    distMiles: number
    assignments: number[]
  } {
    if (centers.length === 0) {
      return { cost: 0, distMiles: 0, assignments: properties.map(() => -1) }
    }
    let cost = 0
    let distMiles = 0
    const assignments: number[] = []
    for (const p of properties) {
      let bestIdx = 0
      let bestDist = Infinity
      for (let i = 0; i < centers.length; i++) {
        const d = haversineMiles({ lat: p.lat, lng: p.lng }, { lat: centers[i].lat, lng: centers[i].lng })
        if (d < bestDist) {
          bestDist = d
          bestIdx = i
        }
      }
      const v = Math.max(1, p.visits_per_year || 1)
      cost += bestDist * v
      distMiles += bestDist
      assignments.push(bestIdx)
    }
    return { cost, distMiles, assignments }
  }

  // ── Greedy seed ─────────────────────────────────────────────────────────
  // Start with locked branches; greedy-add until len == k.
  const selected: City[] = [...locked_branches]
  // De-dup: if locked already includes >K cities, truncate
  while (selected.length > k) selected.pop()

  while (selected.length < k) {
    const remaining = candidates.filter((c) => !selected.some((s) => isCloseEnough(s, c)))
    if (remaining.length === 0) break

    let bestCity: City | null = null
    let bestCost = Infinity
    for (const c of remaining) {
      const trial = [...selected, c]
      const { cost } = totalCost(trial)
      if (cost < bestCost) {
        bestCost = cost
        bestCity = c
      }
    }
    if (!bestCity) break
    selected.push(bestCity)
  }

  // ── Local search: try swaps until no improvement ────────────────────────
  let iter = 0
  let converged = false
  let { cost: bestCost, distMiles: bestDistMiles, assignments: bestAssignments } =
    totalCost(selected)

  while (iter < max_iterations) {
    iter += 1
    let improved = false

    // Locked positions are immovable — only swap selected[i] for i >= locked_branches.length
    for (let i = locked_branches.length; i < selected.length; i++) {
      for (const candidate of candidates) {
        if (selected.some((s) => isCloseEnough(s, candidate))) continue
        const trial = [...selected]
        trial[i] = candidate
        const { cost, distMiles, assignments } = totalCost(trial)
        if (cost < bestCost - 0.0001) {
          bestCost = cost
          bestDistMiles = distMiles
          bestAssignments = assignments
          selected[i] = candidate
          improved = true
        }
      }
    }

    if (!improved) {
      converged = true
      break
    }
  }

  const driveSpeed = Math.max(1, opts.drive_speed_mph)
  const driveHours = bestDistMiles / driveSpeed

  const assignmentsMap: Record<string, number> = {}
  for (let i = 0; i < properties.length; i++) {
    assignmentsMap[properties[i].id] = bestAssignments[i] ?? -1
  }

  return {
    selected_cities: selected,
    assignments: assignmentsMap,
    total_drive_distance_miles: bestDistMiles,
    total_drive_hours: driveHours,
    total_drive_cost_proxy: bestCost,
    iterations: iter,
    converged,
    eligible_city_count: eligible.length,
  }
}
