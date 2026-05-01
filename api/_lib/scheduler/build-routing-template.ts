// Phase 4d — pure template builder.
//
// Given routed properties + branches + crew_count + config, produces:
//   - cycle_length_days (from highest-frequency parent interval)
//   - clusters (local per-branch, remote density-clustered at 30mi)
//   - per-crew load-balanced assignment
//   - trips with relative_start_day in [0, cycle_length_days)
//   - per-day routes (calls Phase 4c routeDay() per day)
//   - cost rollup (drive + labor + overnight)
//   - optimization score
//
// No I/O. Caller loads data + persists the result.
import { haversineMiles, driveTimeMinutes, centroid } from '../analysis/haversine.js'
import { densityCluster, groupByNearestBranch } from './cluster.js'
import { computeCycleLength } from './cycle-length.js'
import { routeDay } from './route-day.js'
import {
  evaluateConstraint,
  type StoredConstraint,
} from './constraint-evaluator.js'
import { nearestCity } from '../analysis/constrained-kmeans.js'

export interface PropertyForBuild {
  service_location_id: string
  property_id: string
  address: string
  lat: number
  lng: number
  parent_offering_id: string
  parent_offering_name: string
  parent_visit_interval_years: number
  base_hours_per_visit: number
  // Phase 4.3 — needed by the same-day pairing rule (combined-sqft cap).
  serviceable_sqft: number
  constraints: StoredConstraint[]
  // Phase 3.8 — per-SL building-size override (forwarded to routeDay so
  // the in-day pairing rule respects manual reclassifications).
  building_size_class_override?: 'small' | 'standard' | 'large' | 'multi_day' | null
  eligible_addons: Array<{
    cohort_assignment_id: string
    offering_id: string
    offering_name: string
    visit_interval_years: number
    hours_addition: number
    cohort_index: number
    next_due_year: number
  }>
}

export interface BuildTemplateInput {
  account_id: string
  client_id: string
  routed_properties: PropertyForBuild[]
  branches: Array<{ name: string; lat: number; lng: number }>
  crew_count: number
  config: {
    crew_size: number
    hours_per_day: number
    work_start_time: string
    work_end_time: string
    buffer_minutes_per_stop: number
    drive_speed_mph: number
    overnight_trigger_one_way_hours: number
    cluster_radius_miles: number
    max_work_hours_per_crew_day: number
    fuel_cost_per_mile: number
    hourly_loaded_labor_cost: number
    cost_per_night: number
    per_diem_per_night: number
    // Phase 4.3 — passed through to routeDay for the same-day pairing rule.
    in_day_pairing_max_drive_minutes?: number
    in_day_pairing_max_combined_sqft?: number
    in_day_pairing_max_buildings_per_day?: number
  }
  custom_cycle_length_days?: number
  preferences: {
    objective: 'minimize_drive' | 'maximize_utilization' | 'balanced'
    soft_constraint_weight: number
    allow_hard_constraint_violation: boolean
  }
  cycle_start_year: number
  // Phase 4.5d — operator-supplied branch overrides keyed by SL id.
  // When present, the rebalance pass FORCES that property to the
  // specified branch (no auto-rebalance for it). All other properties
  // run through the normal capacity-circle algorithm.
  branch_assignment_overrides?: Record<string, number>
}

interface VisitSpec {
  service_location_id: string
  property_id: string
  parent_offering_id: string
  parent_offering_name: string
  visit_number_in_cycle: number
  visits_per_cycle: number
  base_hours: number
  attached_addons: Array<{
    offering_id: string
    offering_name: string
    hours: number
    cohort_assignment_id: string
    cohort_year: number
  }>
  hours_per_visit: number
  target_relative_day_window: [number, number]
  target_calendar_year: number
  lat: number
  lng: number
  serviceable_sqft: number
  constraints: StoredConstraint[]
  address: string
  building_size_class_override?: 'small' | 'standard' | 'large' | 'multi_day' | null
}

interface ClusterSpec {
  cluster_id: string
  cluster_label: string
  cluster_type: 'local' | 'remote'
  base_branch_index: number
  centroid_lat: number
  centroid_lng: number
  visit_specs: VisitSpec[]
  total_work_hours: number
  estimated_drive_hours: number
  trips_per_cycle: number
  days_on_site_per_trip: number
}

export interface TemplateBuildResult {
  cycle_length_days: number
  cycle_length_label: string
  geographic_clusters: any[]
  crew_assignments: Array<{
    crew_index: number
    crew_label: string
    cluster_ids: string[]
    total_work_hours: number
    total_drive_hours: number
  }>
  trips: any[]
  unplaced_visits: any[]
  total_visits_required_per_cycle: number
  total_visits_per_cycle: number
  total_drive_minutes_per_cycle: number
  total_work_minutes_per_cycle: number
  total_overnight_nights_per_cycle: number
  total_drive_miles_per_cycle: number
  total_estimated_cost_per_cycle: number
  total_estimated_cost_per_year: number
  hard_constraint_violations: number
  soft_constraint_violations: number
  optimization_score: number
  optimizer_notes: string
  classification_audit: {
    total_properties: number
    local_count: number
    remote_count: number
    remote_pct: number
    threshold_hours: number
    drive_speed_mph: number
    branch_validation_issues: string[]
    sample: Array<{
      address: string
      nearest_branch: string
      miles_to_nearest: number
      drive_hours_to_nearest: number
      classified: 'local' | 'remote'
    }>
  }
  // Phase 4.4 — pairing + pacing analysis surfaced for the cycle summary.
  pacing_analysis: {
    per_crew: Array<{
      crew_index: number
      crew_label: string
      total_visits: number
      total_workdays_used: number
      single_stop_days: number
      paired_days: number
      pair_rate_pct: number
      cycle_end_workday: number
      days_idle_at_end: number
    }>
    crew_end_workday_spread: number
    target_spread_workdays: number
    pairing_stats: {
      total_workdays: number
      single_stop_days: number
      paired_days: number
      pair_rate_pct: number
    }
  }
  warnings: Array<{
    type: 'crew_load_imbalance' | 'crew_end_date_spread' | 'pairing_underutilized'
    message: string
    affected_crews?: number[]
    suggested_action?: string
  }>
  // Phase 4.5d — per-property branch recommendations from the
  // capacity-circle rebalance. UI renders this as the "Branch
  // Assignments" view where operators can override a property's
  // assigned branch (those overrides flow back as input next build).
  branch_assignments: Array<{
    service_location_id: string
    property_id: string
    address: string
    nearest_branch_idx: number
    assigned_branch_idx: number
    transferred: boolean
    overridden: boolean
  }>
}

const DAYS_PER_YEAR = 365

export function buildRoutingTemplate(input: BuildTemplateInput): TemplateBuildResult {
  // ── 1. Cycle length ───────────────────────────────────────────────
  const cycleResult = computeCycleLength(
    input.routed_properties.map((p) => ({
      service_location_id: p.service_location_id,
      parent_offering_visit_interval_years: p.parent_visit_interval_years,
    })),
    input.custom_cycle_length_days
  )
  const cycleDays = cycleResult.cycle_length_days

  // ── 2. Build visit specs (with addon attachment) ──────────────────
  const visitSpecs: VisitSpec[] = []
  let totalRequired = 0
  for (const p of input.routed_properties) {
    if (p.parent_visit_interval_years <= 0) continue
    const intervalDays = p.parent_visit_interval_years * DAYS_PER_YEAR
    if (intervalDays > cycleDays) {
      // Property visits less often than the cycle — skipped in this builder.
      // Cycle generator handles the parity case.
      continue
    }
    const visitsPerCycle = Math.max(1, Math.round(cycleDays / intervalDays))

    for (let visitIndex = 0; visitIndex < visitsPerCycle; visitIndex++) {
      totalRequired++
      const segmentSize = cycleDays / visitsPerCycle
      const targetMidpoint = segmentSize * (visitIndex + 0.5)
      const targetWindow: [number, number] = [
        Math.max(0, targetMidpoint - segmentSize / 4),
        Math.min(cycleDays, targetMidpoint + segmentSize / 4),
      ]
      const targetCalendarYear = input.cycle_start_year + Math.floor(targetMidpoint / DAYS_PER_YEAR)

      // Attach addons that are due in this calendar year and haven't been
      // attached to an earlier visit of the same property in this cycle.
      const attached: VisitSpec['attached_addons'] = []
      for (const addon of p.eligible_addons) {
        if (addon.next_due_year !== targetCalendarYear) continue
        const earlierSpec = visitSpecs.find(
          (v) =>
            v.service_location_id === p.service_location_id &&
            v.attached_addons.some((a) => a.offering_id === addon.offering_id)
        )
        if (earlierSpec) continue
        attached.push({
          offering_id: addon.offering_id,
          offering_name: addon.offering_name,
          hours: addon.hours_addition,
          cohort_assignment_id: addon.cohort_assignment_id,
          cohort_year: addon.next_due_year,
        })
      }
      const totalHours = p.base_hours_per_visit + attached.reduce((s, a) => s + a.hours, 0)

      visitSpecs.push({
        service_location_id: p.service_location_id,
        property_id: p.property_id,
        parent_offering_id: p.parent_offering_id,
        parent_offering_name: p.parent_offering_name,
        visit_number_in_cycle: visitIndex + 1,
        visits_per_cycle: visitsPerCycle,
        base_hours: p.base_hours_per_visit,
        attached_addons: attached,
        hours_per_visit: totalHours,
        target_relative_day_window: targetWindow,
        target_calendar_year: targetCalendarYear,
        lat: p.lat,
        lng: p.lng,
        serviceable_sqft: p.serviceable_sqft,
        constraints: p.constraints,
        address: p.address,
        building_size_class_override: p.building_size_class_override ?? null,
      })
    }
  }

  // ── 3. Geographic clustering ──────────────────────────────────────
  const overnightTriggerHours = input.config.overnight_trigger_one_way_hours
  const speed = input.config.drive_speed_mph

  // Defensive: branches with NaN/0 lat or lng cause haversine to return
  // garbage (often huge), which marks every property as remote. This
  // is a frequent root cause of "every property looks like overnight."
  const branchValidationIssues: string[] = []
  for (let i = 0; i < input.branches.length; i++) {
    const b = input.branches[i]
    if (
      !Number.isFinite(b.lat) ||
      !Number.isFinite(b.lng) ||
      Math.abs(b.lat) < 1e-6 ||
      Math.abs(b.lng) < 1e-6 ||
      Math.abs(b.lat) > 90 ||
      Math.abs(b.lng) > 180
    ) {
      branchValidationIssues.push(
        `Branch "${b.name ?? `#${i + 1}`}" has invalid coordinates (${b.lat}, ${b.lng}); every property will look far from this branch.`
      )
    }
  }
  if (
    !Number.isFinite(overnightTriggerHours) ||
    overnightTriggerHours <= 0
  ) {
    branchValidationIssues.push(
      `overnight_trigger_one_way_hours is ${overnightTriggerHours}; with a non-positive threshold every property classifies as overnight. Set to 3 hr unless you really mean it.`
    )
  }

  const local: VisitSpec[] = []
  const remote: VisitSpec[] = []
  // Audit: per-property classification trace, sampled for the response
  // notes when an unusually large fraction lands in "remote." Helps
  // the user diagnose Cycle 7-style "everything is overnight" reports.
  type ClassEntry = {
    address: string
    nearest_branch: string
    miles_to_nearest: number
    drive_hours_to_nearest: number
    classified: 'local' | 'remote'
  }
  const classificationAudit: ClassEntry[] = []
  for (const v of visitSpecs) {
    if (input.branches.length === 0) {
      local.push(v)
      continue
    }
    let bestDist = Infinity
    let bestBranchName = ''
    for (const b of input.branches) {
      const d = haversineMiles({ lat: v.lat, lng: v.lng }, b)
      if (d < bestDist) {
        bestDist = d
        bestBranchName = b.name ?? ''
      }
    }
    const hours = driveTimeMinutes(bestDist, speed) / 60
    const classified = hours > overnightTriggerHours ? 'remote' : 'local'
    classificationAudit.push({
      address: v.address,
      nearest_branch: bestBranchName,
      miles_to_nearest: Math.round(bestDist * 10) / 10,
      drive_hours_to_nearest: Math.round(hours * 100) / 100,
      classified,
    })
    if (classified === 'remote') remote.push(v)
    else local.push(v)
  }
  const remotePct =
    visitSpecs.length > 0 ? (remote.length / visitSpecs.length) * 100 : 0

  // ── Phase 4.5d — Pre-cluster property rebalance (formula-driven) ──
  // Operator's algorithm:
  //   1. Define each branch's hours-capacity from crews × cycleDays × hours_per_day.
  //   2. Each branch independently picks its closest properties (lowest
  //      cost = work + 2×drive/speed) until its capacity is full —
  //      this is its "wants list."
  //   3. For any property wanted by multiple branches, the closest
  //      branch wins; the others lose that capacity slot, which
  //      becomes idle days for those branches.
  //   4. Properties not on any wants list (every nearby branch was
  //      already full) try to place on whatever branch still has room,
  //      closest first.
  //   5. Anything still unplaced is genuine overflow that no branch
  //      can fit — surfaces via the existing unplaced path.
  //
  // No hardcoded distance ratios. Capacity is the only gate, and cost
  // includes round-trip drive — so a transfer's recipient is charged
  // for the long drive in its budget, naturally rejecting transfers
  // that would actually cost more than they save.
  const localBranchAssignment = new Map<string, number>()
  const branchAssignmentsOutput: TemplateBuildResult['branch_assignments'] = []
  let propertiesTransferred = 0
  if (local.length > 0 && input.branches.length > 1) {
    type EnrichedVisit = {
      v: VisitSpec
      distances: number[]
      nearest_idx: number
    }
    const enriched: EnrichedVisit[] = local.map((v) => {
      const distances = input.branches.map((b) =>
        haversineMiles({ lat: v.lat, lng: v.lng }, b)
      )
      let nearest = 0
      for (let i = 1; i < distances.length; i++) {
        if (distances[i] < distances[nearest]) nearest = i
      }
      return { v, distances, nearest_idx: nearest }
    })
    const costOn = (e: EnrichedVisit, branchIdx: number): number => {
      const driveHours = (e.distances[branchIdx] * 2) / Math.max(speed, 1)
      return e.v.hours_per_visit + driveHours
    }

    // Remote work hours pinned to nearest branch — these can't be
    // moved (overnight clusters are already remote), so they consume
    // capacity that the local rebalance can't reclaim.
    const remoteHoursByBranch = new Map<number, number>()
    for (const v of remote) {
      let nIdx = 0
      let nDist = Number.POSITIVE_INFINITY
      for (let i = 0; i < input.branches.length; i++) {
        const d = haversineMiles({ lat: v.lat, lng: v.lng }, input.branches[i])
        if (d < nDist) {
          nDist = d
          nIdx = i
        }
      }
      const drv = (nDist * 2) / Math.max(speed, 1)
      remoteHoursByBranch.set(
        nIdx,
        (remoteHoursByBranch.get(nIdx) ?? 0) + v.hours_per_visit + drv
      )
    }

    // Crew distribution proportional to total cost (local + remote).
    const initialCostByBranch = new Map<number, number>()
    for (const e of enriched) {
      initialCostByBranch.set(
        e.nearest_idx,
        (initialCostByBranch.get(e.nearest_idx) ?? 0) + costOn(e, e.nearest_idx)
      )
    }
    for (const [idx, hrs] of remoteHoursByBranch) {
      initialCostByBranch.set(idx, (initialCostByBranch.get(idx) ?? 0) + hrs)
    }
    const branchesByLoad = Array.from(initialCostByBranch.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([idx]) => idx)
    const grandTotal =
      Array.from(initialCostByBranch.values()).reduce((s, v) => s + v, 0) || 1
    const crewsPerBranch = new Map<number, number>()
    let remCrews = input.crew_count
    for (const idx of branchesByLoad) {
      if (remCrews <= 0) {
        crewsPerBranch.set(idx, 0)
        continue
      }
      const share = (initialCostByBranch.get(idx) ?? 0) / grandTotal
      const allocated = Math.max(1, Math.floor(share * input.crew_count))
      const give = Math.min(allocated, remCrews)
      crewsPerBranch.set(idx, give)
      remCrews -= give
    }
    let cur = 0
    while (remCrews > 0 && branchesByLoad.length > 0) {
      const idx = branchesByLoad[cur % branchesByLoad.length]
      crewsPerBranch.set(idx, (crewsPerBranch.get(idx) ?? 0) + 1)
      remCrews--
      cur++
    }

    const hoursPerDay = input.config.hours_per_day || 10
    // Local-rebalance capacity = total branch capacity minus its remote
    // commitments (Frisco's OK overnight work pre-claims part of Frisco's
    // hours; the rebalance can only shuffle locals into what's left).
    const capacityByBranch = new Map<number, number>()
    for (let b = 0; b < input.branches.length; b++) {
      const crews = crewsPerBranch.get(b) ?? 0
      const totalCap = crews * cycleDays * hoursPerDay
      const remoteCommitted = remoteHoursByBranch.get(b) ?? 0
      capacityByBranch.set(b, Math.max(0, totalCap - remoteCommitted))
    }

    // Apply operator overrides first — those properties are FORCED to
    // their override branch and don't enter the wants-list competition.
    // Their cost still counts against their target branch's capacity
    // so the engine doesn't double-book.
    const overrides = input.branch_assignment_overrides ?? {}
    const overriddenIds = new Set<string>()
    const usedFromOverrides = new Map<number, number>()
    for (const e of enriched) {
      const override = overrides[e.v.service_location_id]
      if (typeof override === 'number' && override >= 0 && override < input.branches.length) {
        localBranchAssignment.set(e.v.service_location_id, override)
        overriddenIds.add(e.v.service_location_id)
        usedFromOverrides.set(override, (usedFromOverrides.get(override) ?? 0) + costOn(e, override))
      }
    }

    // Step 1: each branch picks its closest-fit properties until its
    // capacity (after subtracting remote commitments AND override-
    // claimed hours) is full. Overridden properties are skipped here.
    const wantsByBranch = new Map<number, Set<string>>()
    for (let b = 0; b < input.branches.length; b++) {
      const cap = (capacityByBranch.get(b) ?? 0) - (usedFromOverrides.get(b) ?? 0)
      const sorted = [...enriched]
        .filter((e) => !overriddenIds.has(e.v.service_location_id))
        .sort((a, c) => costOn(a, b) - costOn(c, b))
      const wants = new Set<string>()
      let used = 0
      for (const e of sorted) {
        const c = costOn(e, b)
        if (used + c > cap) continue
        wants.add(e.v.service_location_id)
        used += c
      }
      wantsByBranch.set(b, wants)
    }

    // Step 2: conflict resolution — each property goes to the wanter
    // with the lowest cost (closest = best fit).
    for (const e of enriched) {
      const wanters: number[] = []
      for (const [b, set] of wantsByBranch) {
        if (set.has(e.v.service_location_id)) wanters.push(b)
      }
      if (wanters.length === 0) continue
      let best = wanters[0]
      let bestC = costOn(e, best)
      for (const b of wanters) {
        const c = costOn(e, b)
        if (c < bestC) {
          best = b
          bestC = c
        }
      }
      localBranchAssignment.set(e.v.service_location_id, best)
      if (best !== e.nearest_idx) propertiesTransferred++
    }

    // Step 3: any property no branch wanted gets placed wherever has
    // remaining hours-budget, closest first.
    const usedByBranch = new Map<number, number>()
    for (const e of enriched) {
      const b = localBranchAssignment.get(e.v.service_location_id)
      if (b == null) continue
      usedByBranch.set(b, (usedByBranch.get(b) ?? 0) + costOn(e, b))
    }
    for (const e of enriched) {
      if (localBranchAssignment.has(e.v.service_location_id)) continue
      const branchOrder = Array.from({ length: input.branches.length }, (_, i) => i).sort(
        (a, b) => costOn(e, a) - costOn(e, b)
      )
      for (const b of branchOrder) {
        const cap = capacityByBranch.get(b) ?? 0
        const used = usedByBranch.get(b) ?? 0
        const c = costOn(e, b)
        if (used + c > cap) continue
        localBranchAssignment.set(e.v.service_location_id, b)
        usedByBranch.set(b, used + c)
        if (b !== e.nearest_idx) propertiesTransferred++
        break
      }
      // Anything still unassigned is genuine overflow — falls through
      // to the engine's existing unplaced-visits path. Gap-fill (#196)
      // takes a final crack on idle workdays.
    }

    // Emit per-property branch_assignments so the UI can show the
    // recommendation and let operators override.
    for (const e of enriched) {
      const assigned = localBranchAssignment.get(e.v.service_location_id) ?? -1
      branchAssignmentsOutput.push({
        service_location_id: e.v.service_location_id,
        property_id: e.v.property_id,
        address: e.v.address,
        nearest_branch_idx: e.nearest_idx,
        assigned_branch_idx: assigned,
        transferred: assigned !== e.nearest_idx && assigned >= 0,
        overridden: overriddenIds.has(e.v.service_location_id),
      })
    }
  }

  const clusters: ClusterSpec[] = []
  // Local clusters: one per branch (post-rebalance assignment).
  if (local.length > 0 && input.branches.length > 0) {
    const grouped =
      localBranchAssignment.size > 0
        ? (() => {
            const map = new Map<number, VisitSpec[]>()
            for (const v of local) {
              const idx = localBranchAssignment.get(v.service_location_id)
              if (idx == null) continue
              const arr = map.get(idx) ?? []
              arr.push(v)
              map.set(idx, arr)
            }
            return map
          })()
        : groupByNearestBranch(local, input.branches)
    for (const [branchIdx, group] of grouped) {
      const c = centroid(group.map((v) => ({ lat: v.lat, lng: v.lng })))
      clusters.push(makeCluster(`local-${branchIdx}`, 'local', branchIdx, c, group, input))
    }
  } else if (local.length > 0) {
    const c = centroid(local.map((v) => ({ lat: v.lat, lng: v.lng })))
    clusters.push(makeCluster(`local-0`, 'local', 0, c, local, input))
  }

  // Remote clusters: density cluster at radius. Each goes to its own
  // nearest branch.
  if (remote.length > 0) {
    const grouped = densityCluster(remote, input.config.cluster_radius_miles)
    for (let gi = 0; gi < grouped.length; gi++) {
      const group = grouped[gi]
      const c = centroid(group.map((v) => ({ lat: v.lat, lng: v.lng })))
      let bestBranchIdx = 0
      let bestDist = Infinity
      for (let i = 0; i < input.branches.length; i++) {
        const d = haversineMiles(c, input.branches[i])
        if (d < bestDist) {
          bestDist = d
          bestBranchIdx = i
        }
      }
      clusters.push(makeCluster(`remote-${gi}`, 'remote', bestBranchIdx, c, group, input))
    }
  }

  // ── 4. Crew assignment (Phase 4.5 — capacity-aware geographic) ────
  // Step 1: Pre-seed each crew with a home_branch_index so distance
  // calculations are well-defined from the FIRST cluster onward. The
  // earlier version returned distance 0 for empty crews, which made
  // them silently win every tie even when they shouldn't.
  //
  // First N crews (where N = min(crew_count, branch_count)) get one
  // unique branch each. Extra crews (when crew_count > branch_count)
  // go to the branch with the most cluster work hours.
  //
  // Step 2: Each cluster goes first to a same-home-branch crew with
  // capacity (cluster fits within the crew's remaining workday budget).
  // If none, spills to the geographically closest crew with capacity.
  // If everywhere is full, falls back to the closest crew anyway and
  // emits a crew_load_imbalance warning so the operator knows the
  // overflow is unavoidable with current crew_count + cycle_length.
  const workByBranchIdx = new Map<number, number>()
  for (const c of clusters) {
    workByBranchIdx.set(
      c.base_branch_index,
      (workByBranchIdx.get(c.base_branch_index) ?? 0) + c.total_work_hours
    )
  }
  const branchesByLoadDesc = Array.from(workByBranchIdx.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([idx]) => idx)

  const crews = Array.from({ length: input.crew_count }, (_, i) => {
    let homeBranchIdx: number
    if (i < input.branches.length) {
      // Direct assignment: crew i → branch i, in branch input order.
      homeBranchIdx = i
    } else if (branchesByLoadDesc.length > 0) {
      // Extra crews go to the busiest branches in load order, cycling
      // if there are still more crews than busy branches.
      homeBranchIdx = branchesByLoadDesc[(i - input.branches.length) % branchesByLoadDesc.length]
    } else {
      homeBranchIdx = 0
    }
    return {
      index: i,
      label: `Crew ${i + 1}`,
      cluster_ids: [] as string[],
      total_work_hours: 0,
      total_drive_hours: 0,
      workdays_assigned: 0,
      home_branch_index: homeBranchIdx,
    }
  })

  // Sort clusters biggest-first: heavy clusters drive the placement
  // decisions, smaller ones fill in gaps.
  const sortedClusters = [...clusters].sort((a, b) => b.total_work_hours - a.total_work_hours)

  let rebalanceWarning: string | null = null
  let rebalanceSpillCount = 0
  for (const cluster of sortedClusters) {
    const clusterWorkdays = cluster.days_on_site_per_trip * cluster.trips_per_cycle

    const distFor = (crewHomeBranchIdx: number): number => {
      const branch = input.branches[crewHomeBranchIdx]
      if (!branch) return Number.MAX_SAFE_INTEGER
      return haversineMiles(
        { lat: cluster.centroid_lat, lng: cluster.centroid_lng },
        { lat: branch.lat, lng: branch.lng }
      )
    }

    // Try same-home-branch crews with capacity first.
    const naturalFit = crews
      .filter(
        (c) =>
          c.home_branch_index === cluster.base_branch_index &&
          c.workdays_assigned + clusterWorkdays <= cycleDays
      )
      .sort((a, b) => a.workdays_assigned - b.workdays_assigned)

    let target: typeof crews[number]
    if (naturalFit.length > 0) {
      target = naturalFit[0]
    } else {
      // Spill to the geographically closest crew with capacity.
      const fittingCrews = crews
        .filter((c) => c.workdays_assigned + clusterWorkdays <= cycleDays)
        .sort((a, b) => {
          const da = distFor(a.home_branch_index)
          const db = distFor(b.home_branch_index)
          if (da !== db) return da - db
          return a.workdays_assigned - b.workdays_assigned
        })
      if (fittingCrews.length > 0) {
        target = fittingCrews[0]
        rebalanceSpillCount++
      } else {
        // No crew has capacity anywhere — nearest crew anyway, warn.
        const sortedAll = [...crews].sort((a, b) => {
          const da = distFor(a.home_branch_index)
          const db = distFor(b.home_branch_index)
          if (da !== db) return da - db
          return a.workdays_assigned - b.workdays_assigned
        })
        target = sortedAll[0]
        if (rebalanceWarning == null) {
          rebalanceWarning =
            'All crews exceed cycle capacity — overflow will surface as unplaced. Add a crew or extend cycle_length_days.'
        }
      }
    }

    target.cluster_ids.push(cluster.cluster_id)
    target.total_work_hours += cluster.total_work_hours
    target.total_drive_hours += cluster.estimated_drive_hours
    target.workdays_assigned += clusterWorkdays
  }

  // Branch-prefixed crew labels: pick each crew's dominant branch
  // (most work hours among assigned clusters) and number per-branch so
  // labels read "Frisco TX Crew 1", "Frisco TX Crew 2", "Sugarland Crew 1".
  if (input.branches.length > 0) {
    const branchCounters = new Map<number, number>()
    for (const crew of crews) {
      const workByBranch = new Map<number, number>()
      for (const clusterId of crew.cluster_ids) {
        const cluster = clusters.find((c) => c.cluster_id === clusterId)
        if (!cluster) continue
        workByBranch.set(
          cluster.base_branch_index,
          (workByBranch.get(cluster.base_branch_index) ?? 0) + cluster.total_work_hours
        )
      }
      let dominantBranchIdx = -1
      let dominantHours = -1
      for (const [idx, hours] of workByBranch) {
        if (hours > dominantHours) {
          dominantHours = hours
          dominantBranchIdx = idx
        }
      }
      if (dominantBranchIdx >= 0) {
        const branchName = input.branches[dominantBranchIdx]?.name ?? `Branch ${dominantBranchIdx + 1}`
        const counter = (branchCounters.get(dominantBranchIdx) ?? 0) + 1
        branchCounters.set(dominantBranchIdx, counter)
        crew.label = `${branchName} Crew ${counter}`
      }
    }
  }

  // ── 5. Sequence trips on cycle calendar ───────────────────────────
  const trips: any[] = []
  const unplaced: any[] = []

  for (const crew of crews) {
    let nextAvailableDay = 0
    for (const clusterId of crew.cluster_ids) {
      const cluster = clusters.find((c) => c.cluster_id === clusterId)!
      for (let visitIdx = 0; visitIdx < cluster.trips_per_cycle; visitIdx++) {
        // days_on_site_per_trip is an estimate. The actual day-loop runs
        // until we run out of properties or hit the cycle boundary —
        // routeDay's per-day capacity is real-world (drive + buffer eat
        // into the 10-hour window) so we'd otherwise leave properties
        // unplaced just because the estimate was conservative.
        const tripDurationEstimate = cluster.days_on_site_per_trip
        // Remote trips spread across the cycle (target the midpoint of
        // each visit segment); local trips pack sequentially from day 0
        // since they're continuous work, not discrete visits.
        let tripStart: number
        if (cluster.cluster_type === 'remote') {
          const targetStart = Math.floor(
            (cycleDays * (visitIdx + 0.5)) / cluster.trips_per_cycle
          )
          tripStart = Math.max(targetStart, nextAvailableDay)
        } else {
          tripStart = nextAvailableDay
        }
        // Hard cap: trip can't run past the cycle window.
        const maxDaysForTrip = Math.max(1, cycleDays - tripStart)

        // Build per-day routes via routeDay(). Visits eligible for THIS
        // visit_index of THIS cluster:
        const visitsForThisInstance = cluster.visit_specs.filter(
          (v) => v.visit_number_in_cycle === visitIdx + 1
        )

        if (visitsForThisInstance.length === 0) {
          continue
        }

        const baseBranch = input.branches[cluster.base_branch_index] ?? input.branches[0]
        const startLoc = { type: 'branch', name: baseBranch?.name ?? 'Branch', lat: baseBranch?.lat ?? 0, lng: baseBranch?.lng ?? 0 }

        // For multi-day trips, place all visits in a single day's routeDay
        // and let it overflow naturally. We simulate by calling routeDay
        // with hours_per_day = max_work_hours_per_crew_day * tripDuration —
        // but routeDay enforces work_end_time. Simpler: split visits across
        // days greedily.
        const days: any[] = []
        let remaining = [...visitsForThisInstance]
        let dayNumber = 1
        let dayStartLoc = startLoc

        while (remaining.length > 0 && dayNumber <= maxDaysForTrip) {
          // For local clusters, every day returns to branch.
          // For remote clusters, return to branch only on the final day
          // of the trip — which we now determine dynamically: it's the
          // day on which `remaining.length === 1` (about to finish the
          // last property) OR we've hit the maxDaysForTrip cap.
          // The simpler heuristic: return on the day that places the last
          // remaining property. We can't know that prospectively, so we
          // use a two-pass approach below: route without return, and if
          // it places everything, mark this day as the last one.
          const isLikelyLastDay =
            cluster.cluster_type === 'local' ||
            dayNumber === maxDaysForTrip ||
            // Heuristic: if remaining work ≤ one day's worth, this is the last.
            remaining.reduce((s, v) => s + v.hours_per_visit, 0) <=
              input.config.max_work_hours_per_crew_day
          const candidatePool = remaining.map((v) => ({
            id: v.service_location_id,
            property_id: v.property_id,
            address: v.address,
            lat: v.lat,
            lng: v.lng,
            hours_per_visit: v.hours_per_visit,
            visits_per_year: 1,
            serviceable_sqft: v.serviceable_sqft,
            constraints: v.constraints,
            building_size_class_override: v.building_size_class_override ?? null,
          }))
          const baseRoutingConfig = {
            crew_size: input.config.crew_size,
            hours_per_day: input.config.hours_per_day,
            work_start_time: input.config.work_start_time,
            work_end_time: input.config.work_end_time,
            buffer_minutes_per_stop: input.config.buffer_minutes_per_stop,
            drive_speed_mph: input.config.drive_speed_mph,
            return_to_branch: isLikelyLastDay,
            in_day_pairing_max_drive_minutes: input.config.in_day_pairing_max_drive_minutes,
            in_day_pairing_max_combined_sqft: input.config.in_day_pairing_max_combined_sqft,
            in_day_pairing_max_buildings_per_day: input.config.in_day_pairing_max_buildings_per_day,
          }
          const baseRoutingPrefs = {
            objective: 'minimize_drive' as const,
            soft_constraint_weight: input.preferences.soft_constraint_weight,
            allow_hard_constraint_violation: input.preferences.allow_hard_constraint_violation,
          }
          let dayResult = routeDay({
            branch: { name: dayStartLoc.name, lat: dayStartLoc.lat, lng: dayStartLoc.lng },
            scheduled_date: '2026-01-01', // placeholder — cycle gen rewrites
            candidate_properties: candidatePool,
            config: baseRoutingConfig,
            preferences: baseRoutingPrefs,
          })

          // Force-place fallback: if no property fit a regular work day,
          // retry with a wide internal day window so oversized single-
          // visit properties (e.g. hours_per_visit > 10) can land
          // somewhere. The configured 08:00–18:00 still defines the
          // *target* day; this fat day is template-internal accounting.
          // Real-world crews would split such visits across days, which
          // the cycle-instance edit flow handles.
          if (dayResult.route.length === 0 && remaining.length > 0) {
            dayResult = routeDay({
              branch: { name: dayStartLoc.name, lat: dayStartLoc.lat, lng: dayStartLoc.lng },
              scheduled_date: '2026-01-01',
              candidate_properties: candidatePool,
              config: { ...baseRoutingConfig, work_end_time: '23:59' },
              preferences: baseRoutingPrefs,
            })
          }

          if (dayResult.route.length === 0) break

          // Map each routed stop back to its visit_spec to attach addon info
          const stopsWithAddons = dayResult.route.map((stop) => {
            const spec = visitsForThisInstance.find(
              (v) => v.service_location_id === stop.service_location_id
            )
            return {
              ...stop,
              parent_offering_id: spec?.parent_offering_id,
              parent_offering_name: spec?.parent_offering_name,
              attached_addons: spec?.attached_addons ?? [],
              hours_per_visit_total: spec?.hours_per_visit ?? 0,
              hours_per_visit_base: spec?.base_hours ?? 0,
              visit_number_in_cycle: spec?.visit_number_in_cycle ?? 1,
              arrival_relative_minutes: minutesFromStart(stop.arrival_time, input.config.work_start_time),
              departure_relative_minutes: minutesFromStart(stop.departure_time, input.config.work_start_time),
            }
          })

          days.push({
            trip_day_number: dayNumber,
            stops: stopsWithAddons,
            summary: dayResult.summary,
          })

          // Subtract the placed visits from remaining
          const placedIds = new Set(dayResult.route.map((s) => s.service_location_id))
          remaining = remaining.filter((v) => !placedIds.has(v.service_location_id))

          // For REMOTE multi-day trips: day N+1 starts from a hotel near
          // the cluster centroid. For LOCAL multi-day trips: day N+1
          // starts back at the branch (crew goes home each evening).
          if (
            remaining.length > 0 &&
            cluster.cluster_type === 'remote'
          ) {
            dayStartLoc = {
              type: 'overnight_anchor',
              name: `Hotel near ${cluster.cluster_label}`,
              lat: cluster.centroid_lat,
              lng: cluster.centroid_lng,
            }
          }
          // For local clusters, dayStartLoc stays as the branch (no change).

          dayNumber++
        }

        // Anything still in `remaining` couldn't fit. Distinguish the
        // failure mode in the detail so the user can act:
        //   - hit cycle end (used == maxDaysForTrip): trip needs longer
        //     cycle, more crews, or the cluster needs to be split
        //   - hit no-fit (used < maxDaysForTrip): some pathological
        //     constraint or geometry left routeDay producing 0 stops
        const usedDays = days.length
        const hitCycleEnd = usedDays >= maxDaysForTrip
        for (const v of remaining) {
          unplaced.push({
            service_location_id: v.service_location_id,
            // Without property_id the cycle generator can't insert the
            // row (scheduled_visits.property_id is NOT NULL with FK to
            // properties.id) and the whole batch rolls back, eating the
            // placed visits too.
            property_id: v.property_id,
            address: v.address,
            reason: 'time_overflow',
            detail: hitCycleEnd
              ? `Trip ran out of cycle days for cluster ${cluster.cluster_label} (used ${usedDays}/${maxDaysForTrip} days; consider adding crews or extending cycle)`
              : `routeDay couldn't fit any remaining property in a day for cluster ${cluster.cluster_label} (gave up after ${usedDays} days; possible constraint or geometry issue)`,
          })
        }

        if (days.length > 0) {
          const tripId = `${cluster.cluster_id}-v${visitIdx + 1}`
          const tripLabel =
            cluster.trips_per_cycle > 1
              ? `${cluster.cluster_label} – Visit ${visitIdx + 1}`
              : cluster.cluster_label
          trips.push({
            trip_id: tripId,
            trip_label: tripLabel,
            crew_index: crew.index,
            cluster_id: cluster.cluster_id,
            cluster_label: cluster.cluster_label,
            trip_type: cluster.cluster_type === 'remote' ? 'overnight' : 'local',
            relative_start_day: tripStart,
            duration_days: days.length,
            start_location: startLoc,
            end_location: startLoc,
            days,
          })
          nextAvailableDay = tripStart + days.length
        }
      }
    }
  }

  // ── 6. Roll-up summary metrics ────────────────────────────────────
  let totalDriveMin = 0
  let totalWorkMin = 0
  let totalBufferMin = 0
  let totalDriveMiles = 0
  let totalNights = 0
  let totalVisitsPlaced = 0
  let hardViolations = 0
  let softViolations = 0

  for (const trip of trips) {
    if (trip.trip_type === 'overnight') totalNights += trip.duration_days
    for (const day of trip.days) {
      const s = day.summary
      totalDriveMin += s.total_drive_minutes
      totalWorkMin += s.total_work_minutes
      totalBufferMin += s.total_buffer_minutes
      totalDriveMiles += s.total_drive_miles
      hardViolations += s.hard_constraint_violations
      softViolations += s.soft_constraint_violations
      totalVisitsPlaced += day.stops.length
    }
  }

  const driveCost = totalDriveMiles * input.config.fuel_cost_per_mile
  const laborCost =
    (totalWorkMin / 60) * input.config.crew_size * input.config.hourly_loaded_labor_cost
  const overnightCost =
    totalNights * input.config.cost_per_night +
    totalNights * input.config.crew_size * input.config.per_diem_per_night
  const cycleCost = driveCost + laborCost + overnightCost
  const yearlyCost = cycleCost * (DAYS_PER_YEAR / cycleDays)

  // Score
  let score = 100
  score -= (totalRequired - totalVisitsPlaced) * 5
  score -= hardViolations * 25
  score -= softViolations * 3
  score = Math.max(0, Math.min(100, Math.round(score)))

  const notes: string[] = []
  if (totalRequired > totalVisitsPlaced) {
    notes.push(`${totalRequired - totalVisitsPlaced} visit(s) couldn't be placed.`)
  }
  if (totalNights > 0) {
    notes.push(`${totalNights} overnight nights/cycle across remote clusters.`)
  }
  // Surface branch / config validation issues found during classification
  // — the most common cause of "every property looks like overnight."
  for (const issue of branchValidationIssues) {
    notes.push(`⚠ ${issue}`)
  }
  if (remotePct >= 50 && visitSpecs.length >= 4) {
    notes.push(
      `⚠ ${Math.round(remotePct)}% of properties (${remote.length}/${visitSpecs.length}) classified as overnight. ` +
        `Likely causes: branch coords wrong, overnight_trigger_one_way_hours too low (${overnightTriggerHours} hr), or drive_speed_mph too low (${speed} mph). ` +
        `Sample: ${classificationAudit.slice(0, 3).map((c) => `"${c.address}" → ${c.miles_to_nearest}mi to ${c.nearest_branch} = ${c.drive_hours_to_nearest}hr (${c.classified})`).join('; ')}.`
    )
  }

  // ── 7. Phase 4.4 — pacing post-process + stats ────────────────────
  // Spread each crew's trips across the cycle so they end within ±10
  // workdays of the latest crew. Operates in workday space (the same
  // unit relative_start_day is in); cycle gen later maps to calendars.
  const tripsByCrew = new Map<number, any[]>()
  for (const t of trips) {
    const arr = tripsByCrew.get(t.crew_index) ?? []
    arr.push(t)
    tripsByCrew.set(t.crew_index, arr)
  }
  // Natural end workday = relative_start_day + duration_days for the latest trip.
  const naturalEndByCrew = new Map<number, number>()
  for (const [crewIdx, list] of tripsByCrew) {
    const end = list.reduce((m, t) => Math.max(m, (t.relative_start_day ?? 0) + (t.duration_days ?? 0)), 0)
    naturalEndByCrew.set(crewIdx, end)
  }
  const latestNaturalEnd = Math.max(0, ...Array.from(naturalEndByCrew.values()))
  // Stretch every crew's trips so their LAST trip ends at latestNaturalEnd
  // (or as close as the cycle horizon allows). Distribute the slack as
  // idle gaps proportional to trip durations between consecutive trips.
  for (const [crewIdx, list] of tripsByCrew) {
    if (list.length === 0) continue
    list.sort((a, b) => (a.relative_start_day ?? 0) - (b.relative_start_day ?? 0))
    const naturalEnd = naturalEndByCrew.get(crewIdx) ?? 0
    if (naturalEnd >= latestNaturalEnd) continue
    const slack = Math.min(latestNaturalEnd - naturalEnd, Math.max(0, cycleDays - naturalEnd))
    if (slack <= 0) continue
    // Distribute slack across the gaps after each trip except the last.
    // For N trips → N-1 gap slots; if there's 1 trip, just delay it.
    const slots = Math.max(1, list.length - 1)
    const baseGap = Math.floor(slack / slots)
    const remainder = slack - baseGap * slots
    let cursor = list[0].relative_start_day ?? 0
    if (list.length === 1) {
      list[0].relative_start_day = cursor + slack
    } else {
      for (let i = 0; i < list.length; i++) {
        list[i].relative_start_day = cursor
        cursor += list[i].duration_days ?? 0
        if (i < list.length - 1) {
          cursor += baseGap + (i < remainder ? 1 : 0)
        }
      }
    }
  }

  // Pair-rate + idle-tail stats. After pacing, "natural end" for slow
  // crews moves up toward the latest crew's end.
  const pacingPerCrew: TemplateBuildResult['pacing_analysis']['per_crew'] = []
  let globalSingleStop = 0
  let globalPaired = 0
  for (const c of crews) {
    const list = tripsByCrew.get(c.index) ?? []
    let workdaysUsed = 0
    let visits = 0
    let single = 0
    let paired = 0
    let lastEnd = 0
    for (const t of list) {
      const dur = t.duration_days ?? 0
      workdaysUsed += dur
      lastEnd = Math.max(lastEnd, (t.relative_start_day ?? 0) + dur)
      for (const day of t.days ?? []) {
        const stops = (day.stops ?? []).length
        visits += stops
        if (stops <= 1) single++
        else paired++
      }
    }
    globalSingleStop += single
    globalPaired += paired
    const totalDays = single + paired
    pacingPerCrew.push({
      crew_index: c.index,
      crew_label: c.label,
      total_visits: visits,
      total_workdays_used: workdaysUsed,
      single_stop_days: single,
      paired_days: paired,
      pair_rate_pct: totalDays > 0 ? Math.round((paired / totalDays) * 1000) / 10 : 0,
      cycle_end_workday: lastEnd,
      days_idle_at_end: Math.max(0, latestNaturalEnd - lastEnd),
    })
  }
  const endWorkdays = pacingPerCrew.map((p) => p.cycle_end_workday).filter((n) => n > 0)
  const crewEndSpread =
    endWorkdays.length > 1 ? Math.max(...endWorkdays) - Math.min(...endWorkdays) : 0
  const TARGET_SPREAD = 10
  const totalDaysGlobal = globalSingleStop + globalPaired
  const pacing_analysis: TemplateBuildResult['pacing_analysis'] = {
    per_crew: pacingPerCrew,
    crew_end_workday_spread: crewEndSpread,
    target_spread_workdays: TARGET_SPREAD,
    pairing_stats: {
      total_workdays: totalDaysGlobal,
      single_stop_days: globalSingleStop,
      paired_days: globalPaired,
      pair_rate_pct: totalDaysGlobal > 0
        ? Math.round((globalPaired / totalDaysGlobal) * 1000) / 10
        : 0,
    },
  }

  const warnings: TemplateBuildResult['warnings'] = []
  if (propertiesTransferred > 0) {
    notes.push(
      `Pre-cluster rebalance reassigned ${propertiesTransferred} property(s) to a non-nearest branch (closer-by-cost branch was full; this branch was the next-best fit with capacity).`
    )
  }
  if (rebalanceSpillCount > 0) {
    notes.push(
      `Capacity-aware rebalance spilled ${rebalanceSpillCount} cluster(s) from their natural home-branch crew to a next-closest crew with room.`
    )
  }
  if (rebalanceWarning) {
    warnings.push({
      type: 'crew_load_imbalance',
      message: rebalanceWarning,
      suggested_action: 'add a crew or extend cycle_length_days',
    })
  }
  if (crewEndSpread > TARGET_SPREAD) {
    const slowest = pacingPerCrew.reduce((a, b) => (a.cycle_end_workday < b.cycle_end_workday ? b : a))
    const fastest = pacingPerCrew.reduce((a, b) => (a.cycle_end_workday > b.cycle_end_workday ? b : a))
    warnings.push({
      type: 'crew_end_date_spread',
      message: `Crew end-workdays spread ${crewEndSpread} (target ≤${TARGET_SPREAD}). ${slowest.crew_label} ends ${crewEndSpread}d after ${fastest.crew_label}.`,
      affected_crews: [slowest.crew_index, fastest.crew_index],
      suggested_action: 're-cluster property assignments across crews to equalize load',
    })
  }
  if (totalDaysGlobal > 20 && pacing_analysis.pairing_stats.pair_rate_pct < 20) {
    warnings.push({
      type: 'pairing_underutilized',
      message: `Pair rate ${pacing_analysis.pairing_stats.pair_rate_pct}% — most days are single-stop. Geography may not have many close pairs, or in_day_pairing_max_drive_minutes is tight.`,
    })
  }

  return {
    cycle_length_days: cycleDays,
    cycle_length_label: cycleResult.cycle_length_label,
    geographic_clusters: clusters.map((c) => ({
      cluster_id: c.cluster_id,
      cluster_label: c.cluster_label,
      cluster_type: c.cluster_type,
      centroid_lat: c.centroid_lat,
      centroid_lng: c.centroid_lng,
      base_branch_index: c.base_branch_index,
      property_count: c.visit_specs.length,
      total_work_hours: c.total_work_hours,
      trips_per_cycle: c.trips_per_cycle,
      days_on_site_per_trip: c.days_on_site_per_trip,
    })),
    crew_assignments: crews.map((c) => ({
      crew_index: c.index,
      crew_label: c.label,
      cluster_ids: c.cluster_ids,
      total_work_hours: c.total_work_hours,
      total_drive_hours: c.total_drive_hours,
    })),
    trips,
    unplaced_visits: unplaced,
    total_visits_required_per_cycle: totalRequired,
    total_visits_per_cycle: totalVisitsPlaced,
    total_drive_minutes_per_cycle: Math.round(totalDriveMin),
    total_work_minutes_per_cycle: Math.round(totalWorkMin),
    total_overnight_nights_per_cycle: totalNights,
    total_drive_miles_per_cycle: Math.round(totalDriveMiles * 10) / 10,
    total_estimated_cost_per_cycle: Math.round(cycleCost),
    total_estimated_cost_per_year: Math.round(yearlyCost),
    hard_constraint_violations: hardViolations,
    soft_constraint_violations: softViolations,
    optimization_score: score,
    optimizer_notes: notes.join(' '),
    classification_audit: {
      total_properties: visitSpecs.length,
      local_count: local.length,
      remote_count: remote.length,
      remote_pct: Math.round(remotePct * 10) / 10,
      threshold_hours: overnightTriggerHours,
      drive_speed_mph: speed,
      branch_validation_issues: branchValidationIssues,
      // First 10 sample classifications for user audit on the cycle UI.
      sample: classificationAudit.slice(0, 10),
    },
    pacing_analysis,
    warnings,
    branch_assignments: branchAssignmentsOutput,
  }
}

function makeCluster(
  cluster_id: string,
  cluster_type: 'local' | 'remote',
  base_branch_index: number,
  c: { lat: number; lng: number },
  visits: VisitSpec[],
  input: BuildTemplateInput
): ClusterSpec {
  const totalWork = visits.reduce((s, v) => s + v.hours_per_visit, 0)
  const tripsPerCycle = Math.max(1, Math.max(...visits.map((v) => v.visits_per_cycle)))
  const branch = input.branches[base_branch_index]
  const driveHours =
    branch != null
      ? driveTimeMinutes(haversineMiles(c, branch), input.config.drive_speed_mph) / 60
      : 0

  // Multi-day applies to local clusters too — a crew working its
  // local cluster doesn't fit ~85 properties × 3hr in one 10hr day.
  // Local: each day starts/ends at the branch (no overnight). Remote:
  // each day after the first starts from a hotel anchor.
  const workPerTrip = totalWork / tripsPerCycle
  const daysOnSite = Math.max(
    1,
    Math.ceil(workPerTrip / input.config.max_work_hours_per_crew_day)
  )

  return {
    cluster_id,
    cluster_label: makeClusterLabel(cluster_type, c, branch),
    cluster_type,
    base_branch_index,
    centroid_lat: c.lat,
    centroid_lng: c.lng,
    visit_specs: visits,
    total_work_hours: totalWork,
    estimated_drive_hours: driveHours * 2 * tripsPerCycle, // round trip per visit
    trips_per_cycle: tripsPerCycle,
    days_on_site_per_trip: daysOnSite,
  }
}

// Human-readable cluster label. For local clusters we use the branch
// name (this is the crew's home base — most familiar to the user). For
// remote clusters we use the nearest city to the centroid.
function makeClusterLabel(
  cluster_type: 'local' | 'remote',
  c: { lat: number; lng: number },
  branch: { name: string; lat: number; lng: number } | undefined
): string {
  if (cluster_type === 'local' && branch) {
    return `${branch.name} (local)`
  }
  const city = nearestCity(c.lat, c.lng)
  if (city) return `${city.city}, ${city.state_id}`
  return `(${c.lat.toFixed(2)}, ${c.lng.toFixed(2)})`
}

function minutesFromStart(iso: string, startHHMM: string): number {
  // iso looks like 'YYYY-MM-DDTHH:MM:00'; extract HH:MM portion.
  const time = iso.slice(11, 16)
  const [h, m] = time.split(':').map(Number)
  const [sh, sm] = startHHMM.split(':').map(Number)
  return h * 60 + m - (sh * 60 + sm)
}
