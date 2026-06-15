/**
 * Unit test: custom cycle length shorter than the portfolio's shortest
 * visit interval should be treated as a one-time planning window —
 * every property gets at least one visit placed, instead of every
 * property being skipped (which produced a 0-visit "failed" template).
 *
 * Regression guard for: custom 120-day cycle on a 2x/year (182-day)
 * portfolio failing because intervalDays > cycleDays skipped everything.
 *
 * Run: npx tsx tests/unit/custom-cycle-window.test.ts
 */
import {
  buildRoutingTemplate,
  type BuildTemplateInput,
  type PropertyForBuild,
} from '../../api/_lib/scheduler/build-routing-template.js'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
}

const BRANCH = { name: 'Phoenix', lat: 33.4, lng: -112.0 }

function prop(id: string, lat: number, lng: number, intervalYears: number): PropertyForBuild {
  return {
    service_location_id: `sl-${id}`,
    property_id: `prop-${id}`,
    address: `${id} Test St, Phoenix, AZ`,
    lat,
    lng,
    parent_offering_id: 'off-1',
    parent_offering_name: 'Project Clean',
    parent_visit_interval_years: intervalYears,
    base_hours_per_visit: 2,
    serviceable_sqft: 10000,
    constraints: [],
    eligible_addons: [],
  }
}

const CONFIG: BuildTemplateInput['config'] = {
  crew_size: 2,
  hours_per_day: 8,
  work_start_time: '08:00',
  work_end_time: '18:00',
  buffer_minutes_per_stop: 15,
  drive_speed_mph: 45,
  overnight_trigger_one_way_hours: 4,
  cluster_radius_miles: 30,
  max_work_hours_per_crew_day: 10,
  fuel_cost_per_mile: 0.65,
  hourly_loaded_labor_cost: 50,
  cost_per_night: 150,
  per_diem_per_night: 50,
}

const PREFS: BuildTemplateInput['preferences'] = {
  objective: 'balanced',
  soft_constraint_weight: 0.5,
  allow_hard_constraint_violation: false,
}

function baseInput(props: PropertyForBuild[], custom?: number): BuildTemplateInput {
  return {
    account_id: 'acct-1',
    client_id: 'client-1',
    routed_properties: props,
    branches: [BRANCH],
    crew_count: 1,
    config: CONFIG,
    custom_cycle_length_days: custom,
    preferences: PREFS,
    cycle_start_year: 2026,
  }
}

// ── Case 1: custom 120-day cycle on a 2x/year (182-day) portfolio ──
// Both properties' interval (182d) exceeds the 120-day cycle. Before the
// fix they were skipped → 0 visits → failed. Now each must be scheduled
// once within the window.
{
  const props = [
    prop('a', 33.41, -112.01, 0.5),
    prop('b', 33.42, -112.02, 0.5),
  ]
  const res = buildRoutingTemplate(baseInput(props, 120))
  assert(res.cycle_length_days === 120, `custom cycle honored (got ${res.cycle_length_days})`)
  assert(
    res.total_visits_required_per_cycle === 2,
    `each property scheduled once in custom window (required=${res.total_visits_required_per_cycle}, expected 2)`
  )
  assert(
    res.total_visits_per_cycle > 0,
    `at least one visit placed → template not 'failed' (placed=${res.total_visits_per_cycle})`
  )
}

// ── Case 2 (regression guard): AUTO cycle must still defer low-frequency
// properties. A 1-year property in an auto 6-month cycle (driven by the
// 2x/year property) should NOT be visited every cycle — it's deferred to
// alternating cycles. Removing the skip entirely would over-service it.
{
  const props = [
    prop('a', 33.41, -112.01, 0.5), // 2x/year → drives auto cycle to ~182d
    prop('c', 33.43, -112.03, 1.0), // 1x/year → 365d > 182d → deferred
  ]
  const res = buildRoutingTemplate(baseInput(props)) // no custom cycle
  assert(
    res.total_visits_required_per_cycle === 1,
    `auto cycle still defers the yearly property (required=${res.total_visits_required_per_cycle}, expected 1)`
  )
}

console.log('PASS: custom-cycle-window')
