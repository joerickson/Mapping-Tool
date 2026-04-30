// Phase 4.2 — single source of truth for "how many crews" + which
// option/source. Every downstream module (bid_pricing, workforce_sizing,
// seasonality_capacity, synthesize, chat) used to read
// crewStrategyOutputs.recommended_option directly. That meant the
// user's manual override (per-branch counts) and selected option
// (A/B/C) only flowed into bid_pricing, leaving FTE counts and
// surge/seasonality math wrong.
//
// Resolution order (highest priority first):
//   1. manual override — sum of crew_count_per_branch_override values
//   2. user-selected option (A/B/C) from crew_strategy_selected_option
//   3. analysis's recommended_option

export type CrewSource =
  | 'manual_override'
  | 'user_selected_option'
  | 'recommended_option'

export interface ResolvedCrews {
  /** Effective option key — A/B/C — even when override is active.
   *  Used to look up labor / vehicle / utilization estimates. */
  effective_option: 'A' | 'B' | 'C'
  /** Total crew count after resolution. */
  crew_count: number
  /** Per-branch breakdown (override values when present, else option's). */
  per_branch: Record<string, number>
  /** Surge crew count from the option (only relevant for Option C and
   *  when no manual override is in play). */
  surge_crew_count: number
  /** Where the count came from. */
  source: CrewSource
}

interface ConstraintsLike {
  crew_strategy_selected_option?: 'A' | 'B' | 'C' | null
  crew_count_per_branch_override?: Record<string, number> | null
}

interface OptionLike {
  crew_count?: number
  surge_crew_count?: number
  branch_breakdown?: Array<{ branch_name: string; crew_count: number }>
  utilization_breakdown?: {
    per_branch?: Array<{ branch_name: string; crew_count: number }>
  }
}

interface CrewStrategyOutputsLike {
  recommended_option?: 'A' | 'B' | 'C'
  options?: Record<string, OptionLike | undefined>
}

function sumOverride(
  override: Record<string, number> | null | undefined
): { total: number; cleaned: Record<string, number> } {
  if (!override || typeof override !== 'object') {
    return { total: 0, cleaned: {} }
  }
  let total = 0
  const cleaned: Record<string, number> = {}
  for (const [k, v] of Object.entries(override)) {
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) {
      const i = Math.max(0, Math.floor(n))
      cleaned[k] = i
      total += i
    }
  }
  return { total, cleaned }
}

function perBranchFromOption(opt: OptionLike | undefined): Record<string, number> {
  if (!opt) return {}
  const breakdown =
    opt.utilization_breakdown?.per_branch ?? opt.branch_breakdown ?? []
  const out: Record<string, number> = {}
  for (const b of breakdown) {
    if (b.branch_name) out[b.branch_name] = Number(b.crew_count) || 0
  }
  return out
}

export function resolveCrews(
  crewStrategyOutputs: CrewStrategyOutputsLike | null | undefined,
  constraints: ConstraintsLike
): ResolvedCrews {
  const recommended = crewStrategyOutputs?.recommended_option ?? 'B'
  const userSelected = constraints.crew_strategy_selected_option
  const effective: 'A' | 'B' | 'C' =
    userSelected === 'A' || userSelected === 'B' || userSelected === 'C'
      ? userSelected
      : recommended

  const opt = crewStrategyOutputs?.options?.[effective]
  const surge = effective === 'C' ? Number(opt?.surge_crew_count ?? 0) : 0

  const { total: overrideTotal, cleaned: overridePerBranch } = sumOverride(
    constraints.crew_count_per_branch_override
  )

  if (overrideTotal > 0) {
    return {
      effective_option: effective,
      crew_count: overrideTotal,
      per_branch: overridePerBranch,
      surge_crew_count: 0,
      source: 'manual_override',
    }
  }

  const baseCrews = Number(opt?.crew_count ?? 0)
  return {
    effective_option: effective,
    crew_count: baseCrews + surge,
    per_branch: perBranchFromOption(opt),
    surge_crew_count: surge,
    source: userSelected ? 'user_selected_option' : 'recommended_option',
  }
}
