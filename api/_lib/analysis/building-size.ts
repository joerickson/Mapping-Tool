// Phase 3.8 — building size classification.
// Phase 4 follow-up — classifier now uses crew-clock hours (hoursPerVisit
// ÷ crew_size) instead of raw labor hours. A 24-hour task done by a
// 3-person crew is 8 clock hours = ONE day, not three. The previous
// version classified anything >16 hr as multi_day and billed 2-4
// crew-days per visit, which inflated total crew-days dramatically
// and produced over-recommended crew counts.

export type BuildingSizeClass = 'small' | 'standard' | 'large' | 'multi_day'

export interface ClassifyContext {
  crew_size: number
  hours_per_day: number
}

const DEFAULT_CTX: ClassifyContext = { crew_size: 3, hours_per_day: 10 }

function clockHours(hoursPerVisit: number, ctx: ClassifyContext): number {
  const cs = Number.isFinite(ctx.crew_size) && ctx.crew_size > 0 ? ctx.crew_size : 1
  return hoursPerVisit / cs
}

export function classifyBuildingSize(
  hoursPerVisit: number,
  ctx: ClassifyContext = DEFAULT_CTX
): BuildingSizeClass {
  const ch = clockHours(hoursPerVisit, ctx)
  const hpd =
    Number.isFinite(ctx.hours_per_day) && ctx.hours_per_day > 0
      ? ctx.hours_per_day
      : 10
  // small = ≤ 40% of a workday — eligible for pairing with another
  //         small in the same day.
  // standard = ≤ 70% of a workday.
  // large = ≤ 1 full workday.
  // multi_day = needs more than 1 calendar day's clock-hours from this
  //         crew. Realistically rare with a 3-person crew on a 10-hr
  //         day (>30 labor-hours of work).
  if (ch <= hpd * 0.4) return 'small'
  if (ch <= hpd * 0.7) return 'standard'
  if (ch <= hpd) return 'large'
  return 'multi_day'
}

export function effectiveSizeClass(
  serviceLocation: {
    hours_per_visit: number
    building_size_class_override?: BuildingSizeClass | null
  },
  ctx: ClassifyContext = DEFAULT_CTX
): BuildingSizeClass {
  return (
    serviceLocation.building_size_class_override ??
    classifyBuildingSize(serviceLocation.hours_per_visit, ctx)
  )
}

export function crewDaysPerVisit(
  sizeClass: BuildingSizeClass,
  hoursPerVisit: number,
  mode: 'conservative' | 'optimistic',
  ctx: ClassifyContext = DEFAULT_CTX
): number {
  switch (sizeClass) {
    case 'small':
      return mode === 'optimistic' ? 0.5 : 1.0
    case 'standard':
      return 1.0
    case 'large':
      return 1.0
    case 'multi_day': {
      const ch = clockHours(hoursPerVisit, ctx)
      const hpd =
        Number.isFinite(ctx.hours_per_day) && ctx.hours_per_day > 0
          ? ctx.hours_per_day
          : 10
      return Math.max(1, Math.ceil(ch / hpd))
    }
  }
}
