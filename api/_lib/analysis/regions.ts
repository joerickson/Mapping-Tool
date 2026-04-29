// State → region mapping for v1. The "Other" bucket catches anything not listed.
export const REGION_MAP: Record<string, string[]> = {
  Texas: ['TX'],
  'New Mexico': ['NM'],
  Oklahoma: ['OK'],
  'Mountain West': ['UT', 'CO', 'AZ', 'NV', 'ID', 'WY', 'MT'],
  'Mid-South': ['AR', 'LA', 'TN', 'MS', 'KY'],
  Plains: ['KS', 'NE', 'SD', 'ND', 'IA', 'MO'],
  Pacific: ['CA', 'OR', 'WA'],
}

const STATE_TO_REGION: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const [region, states] of Object.entries(REGION_MAP)) {
    for (const s of states) m[s] = region
  }
  return m
})()

export function regionForState(stateCode: string | null | undefined): string {
  if (!stateCode) return 'Other'
  return STATE_TO_REGION[stateCode.toUpperCase()] ?? 'Other'
}
