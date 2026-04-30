// Phase 3.8 — building size classification.
//
// Crews can typically only do one building per day regardless of how
// many hours that building takes (setup, breakdown, drive between, and
// crew workflow constraints). Two small buildings can sometimes pair
// in a single day, and very large buildings consume multiple days.

export type BuildingSizeClass = 'small' | 'standard' | 'large' | 'multi_day'

export function classifyBuildingSize(hoursPerVisit: number): BuildingSizeClass {
  if (hoursPerVisit <= 4) return 'small'
  if (hoursPerVisit <= 8) return 'standard'
  if (hoursPerVisit <= 16) return 'large'
  return 'multi_day'
}

export function effectiveSizeClass(serviceLocation: {
  hours_per_visit: number
  building_size_class_override?: BuildingSizeClass | null
}): BuildingSizeClass {
  return (
    serviceLocation.building_size_class_override ??
    classifyBuildingSize(serviceLocation.hours_per_visit)
  )
}

export function crewDaysPerVisit(
  sizeClass: BuildingSizeClass,
  hoursPerVisit: number,
  mode: 'conservative' | 'optimistic'
): number {
  switch (sizeClass) {
    case 'small':
      return mode === 'optimistic' ? 0.5 : 1.0
    case 'standard':
      return 1.0
    case 'large':
      return 1.0
    case 'multi_day':
      return Math.max(1, Math.ceil(hoursPerVisit / 8))
  }
}
