// Per-property "how long does a crew spend here per visit, and how often" —
// extracted from crew-strategy so overnight-calculator can reuse the same
// math without duplicating offering classification + combo-rule logic.
//
// Only project_clean + upholstery offerings count. Recurring janitorial
// is excluded (it's a separate workforce; covered by the Workforce Sizing
// module) and "other" is excluded.
import type { AccountProperty } from './account-data.js'
import { classifyOffering } from './service-offerings.js'

export interface PropertyHoursInputs {
  project_clean_base_hours: number
  project_clean_hours_per_sqft: number
  upholstery_solo_hours: number
  upholstery_combo_hours_pct: number
  visits_per_year_default: number
}

export interface PropertyVisit {
  property: AccountProperty
  // Sum of project-crew hours across all relevant SLs for ONE visit. If a
  // property has both project_clean and upholstery SLs the combo rule has
  // already been applied here.
  hours_per_visit: number
  // Max visits_per_year across the relevant SLs. Operationally: the crew
  // arrives this many times; on lower-frequency visits, fewer SLs are
  // touched but trip overhead (drive, hotels) still applies, so this is
  // the right denominator for trip-based costs.
  visits_per_year: number
  // Total annual project-crew hours at this property. Equals
  // hours_per_visit * visits_per_year only as an upper bound; the true
  // sum across SLs of (hours_per_sl × visits_sl) may differ. We expose
  // this for callers that want the crew-strategy-style aggregate.
  annual_hours: number
}

export function computePropertyVisitHours(
  properties: AccountProperty[],
  offerings: Map<string, { id: string; name: string }>,
  inputs: PropertyHoursInputs
): PropertyVisit[] {
  return properties.map((p) => {
    let hasProjectClean = false
    let hasUpholstery = false
    for (const sl of p.service_locations) {
      const offering = sl.service_offering_id ? offerings.get(sl.service_offering_id) : null
      const cls = offering ? classifyOffering(offering.name) : 'other'
      if (cls === 'project_clean') hasProjectClean = true
      if (cls === 'upholstery') hasUpholstery = true
    }

    let totalHoursPerVisit = 0
    let maxVisits = 0
    let annualHours = 0

    for (const sl of p.service_locations) {
      const offering = sl.service_offering_id ? offerings.get(sl.service_offering_id) : null
      const cls = offering ? classifyOffering(offering.name) : 'other'
      if (cls !== 'project_clean' && cls !== 'upholstery') continue

      const sqft = sl.serviceable_sqft ?? 0
      const visits = sl.visits_per_year_override ?? inputs.visits_per_year_default

      let hoursPerVisit = 0
      if (cls === 'project_clean') {
        hoursPerVisit =
          inputs.project_clean_base_hours + sqft * inputs.project_clean_hours_per_sqft
        if (hasUpholstery) hoursPerVisit *= 1 + inputs.upholstery_combo_hours_pct
      } else if (cls === 'upholstery') {
        if (!hasProjectClean) hoursPerVisit = inputs.upholstery_solo_hours
      }
      hoursPerVisit = Math.max(hoursPerVisit, 1)

      totalHoursPerVisit += hoursPerVisit
      if (visits > maxVisits) maxVisits = visits
      annualHours += hoursPerVisit * visits
    }

    return {
      property: p,
      hours_per_visit: totalHoursPerVisit,
      visits_per_year: maxVisits || inputs.visits_per_year_default,
      annual_hours: annualHours,
    }
  })
}
