import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import Navbar from '../../components/ui/Navbar'
import Button from '../../components/ui/Button'
import AnalysisCard, {
  type AnalysisStatus,
  STUCK_AFTER_MS,
} from '../../components/analysis/AnalysisCard'
import GeographicChart from '../../components/analysis/GeographicChart'
import BranchOptimizationChart from '../../components/analysis/BranchOptimizationChart'
import DriveTimeChart from '../../components/analysis/DriveTimeChart'
import CrewStrategyChart from '../../components/analysis/CrewStrategyChart'
import WorkforceSizingChart from '../../components/analysis/WorkforceSizingChart'
import SeasonalityChart from '../../components/analysis/SeasonalityChart'
import BidPricingChart from '../../components/analysis/BidPricingChart'
import OperationalConstraintsPanel from '../../components/analysis/OperationalConstraintsPanel'
import SynthesisCard from '../../components/analysis/SynthesisCard'
import ScenarioPanel from '../../components/analysis/ScenarioPanel'
import ChatPanel from '../../components/analysis/ChatPanel'
import CostAssumptionsPanel from '../../components/analysis/CostAssumptionsPanel'
import BuildSelectionModal, {
  type SelectedBranch,
  type ExistingBranch as ModalExistingBranch,
  type ReferenceCentroid,
} from '../../components/analysis/BuildSelectionModal'
import SelectionStatusBanner from '../../components/analysis/SelectionStatusBanner'
import AnalysisMap, {
  type AnalysisMapPoint,
  type AnalysisMapBranch,
  type ColorMode,
} from '../../components/analysis/AnalysisMap'
import { colorForBranchIndex } from '../../lib/branch-colors.js'

type ModuleKey =
  | 'geographic_distribution'
  | 'branch_optimization'
  | 'drive_time_logistics'
  | 'crew_strategy'
  | 'workforce_sizing'
  | 'seasonality_capacity'
  | 'bid_pricing_structure'

// Tier 1 = no selection required. Tier 2 = gated on selected_branches.
const TIER_2_MODULES: Set<ModuleKey> = new Set([
  'drive_time_logistics',
  'crew_strategy',
  'workforce_sizing',
  'seasonality_capacity',
  'bid_pricing_structure',
])

const MODULES: Array<{
  key: ModuleKey
  endpoint: string
  title: string
  description: string
}> = [
  {
    key: 'geographic_distribution',
    endpoint: 'geographic-distribution',
    title: 'Geographic Distribution',
    description: 'State + region breakdown and outlier detection.',
  },
  {
    key: 'branch_optimization',
    endpoint: 'branch-optimization',
    title: 'Branch Optimization',
    description: 'k-means cost tradeoff for k = 1..7 with elbow recommendation.',
  },
  {
    key: 'drive_time_logistics',
    endpoint: 'drive-time-logistics',
    title: 'Drive Time & Logistics',
    description: 'Per-property drive time from optimal branches; flags long drives.',
  },
  {
    key: 'crew_strategy',
    endpoint: 'crew-strategy',
    title: 'Crew Strategy',
    description: 'Roving / dedicated / surge crew options with full economics + recommendation.',
  },
  {
    key: 'workforce_sizing',
    endpoint: 'workforce-sizing',
    title: 'Workforce Sizing',
    description: 'FTE count for recurring janitorial workforce, plus reference to project crews.',
  },
  {
    key: 'seasonality_capacity',
    endpoint: 'seasonality-capacity',
    title: 'Seasonality & Capacity',
    description: 'School-break demand windows, surge crew requirements, peak-to-baseline ratio.',
  },
  {
    key: 'bid_pricing_structure',
    endpoint: 'bid-pricing-structure',
    title: 'Bid Pricing Structure',
    description: 'Full cost buildup → margin → final bid. Pulls from upstream modules.',
  },
]

interface AnalysisRow {
  id: string
  account_id: string
  module_key: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  outputs: any
  summary_text: string | null
  property_count: number | null
  created_at: string
  completed_at: string | null
  error_message: string | null
}

interface AccountInfo {
  id: string
  name: string
  display_name: string | null
  stats: { client_count: number; service_location_count: number }
}

export default function AccountAnalysisPage() {
  const { accountId } = useParams<{ accountId: string }>()
  const { getToken } = useAuth()

  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [latestByModule, setLatestByModule] = useState<Record<string, AnalysisRow | null>>({})
  const [running, setRunning] = useState<Record<string, boolean>>({})
  const [pollIds, setPollIds] = useState<Record<string, string>>({})
  // Per-module timing + diagnostics for visible feedback while running
  const [startedAt, setStartedAt] = useState<Record<string, number | null>>({})
  const [lastPolledAt, setLastPolledAt] = useState<Record<string, number | null>>({})
  const [lastPollError, setLastPollError] = useState<Record<string, string | null>>({})
  // Re-render every second so stuck-detection (driven by elapsed time) flips
  // status from 'running' to 'stuck' even between polls.
  const [, setTick] = useState(0)
  const [mapPoints, setMapPoints] = useState<AnalysisMapPoint[]>([])
  const [mapBranches, setMapBranches] = useState<AnalysisMapBranch[]>([])
  const [mapColorMode, setMapColorMode] = useState<ColorMode>('branch')
  // Phase 3.5 — when a module's "[Edit assumptions]" link is clicked, this
  // makes CostAssumptionsPanel auto-expand and scroll to the matching group.
  const [costPanelHighlight, setCostPanelHighlight] = useState<string | null>(null)
  // Live cost-assumption baselines from constraints (in addition to the four
  // already in state for the scenario panel) — used to render the per-card
  // "Using: …" lines.
  const [baselineHoursPerDay, setBaselineHoursPerDay] = useState(10)
  const [baselineWorkingDays, setBaselineWorkingDays] = useState(250)
  const [baselineDriveSpeed, setBaselineDriveSpeed] = useState(60)
  const [baselineMaxDriveMin, setBaselineMaxDriveMin] = useState(120)
  const [baselineProductivity, setBaselineProductivity] = useState(3000)
  const [baselineBranchOverhead, setBaselineBranchOverhead] = useState(240000)
  const [baselineCorporateOverhead, setBaselineCorporateOverhead] = useState(0.08)
  const [mapLoading, setMapLoading] = useState(true)
  const [reassessing, setReassessing] = useState(false)
  const [reassessMessage, setReassessMessage] = useState<string | null>(null)
  // ISO timestamp of the most recent constraints save — used to flag any
  // module whose last completed run is older than this as "stale vs constraints".
  const [constraintsUpdatedAt, setConstraintsUpdatedAt] = useState<string | null>(null)
  // Selection state mirrored from the constraints endpoint.
  const [selectedBranches, setSelectedBranches] = useState<SelectedBranch[] | null>(null)
  const [selectedK, setSelectedK] = useState<number | null>(null)
  const [selectedAt, setSelectedAt] = useState<string | null>(null)
  const [selectedFromAnalysisId, setSelectedFromAnalysisId] = useState<string | null>(null)
  const [existingBranches, setExistingBranches] = useState<ModalExistingBranch[]>([])
  // Numeric constraint baselines (used by ScenarioPanel to seed sliders)
  const [baselineLaborCost, setBaselineLaborCost] = useState(28)
  const [baselineFuelCost, setBaselineFuelCost] = useState(0.18)
  const [baselineMargin, setBaselineMargin] = useState(0.22)
  const [baselineSurgePremium, setBaselineSurgePremium] = useState(1.4)
  // Build-selection modal
  const [modalOpen, setModalOpen] = useState(false)
  const [modalK, setModalK] = useState(0)
  const [modalCentroids, setModalCentroids] = useState<ReferenceCentroid[]>([])
  const [modalSourceAnalysisId, setModalSourceAnalysisId] = useState<string | null>(null)

  // ─── Constraints refresh — call after any save / select / clear ───
  const refreshConstraints = useCallback(async () => {
    if (!accountId) return
    try {
      const token = await getToken()
      const res = await fetch(`/api/accounts/${accountId}/operational-constraints`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const json = await res.json()
      setSelectedBranches(json.selected_branches ?? null)
      setSelectedK(json.selected_k ?? null)
      setSelectedAt(json.selected_at ?? null)
      setSelectedFromAnalysisId(json.selected_from_analysis_id ?? null)
      setExistingBranches((json.existing_branches ?? []) as ModalExistingBranch[])
      setConstraintsUpdatedAt(json.updated_at ?? null)
      if (typeof json.hourly_loaded_labor_cost === 'number') setBaselineLaborCost(json.hourly_loaded_labor_cost)
      if (typeof json.fuel_cost_per_mile === 'number') setBaselineFuelCost(json.fuel_cost_per_mile)
      if (typeof json.target_gross_margin_pct === 'number') setBaselineMargin(json.target_gross_margin_pct)
      if (typeof json.surge_premium_multiplier === 'number') setBaselineSurgePremium(json.surge_premium_multiplier)
      if (typeof json.hours_per_day === 'number') setBaselineHoursPerDay(json.hours_per_day)
      if (typeof json.working_days_per_year === 'number') setBaselineWorkingDays(json.working_days_per_year)
      if (typeof json.drive_speed_mph === 'number') setBaselineDriveSpeed(json.drive_speed_mph)
      if (typeof json.max_one_way_drive_minutes === 'number')
        setBaselineMaxDriveMin(json.max_one_way_drive_minutes)
      if (typeof json.recurring_productivity_sqft_per_hour === 'number')
        setBaselineProductivity(json.recurring_productivity_sqft_per_hour)
      if (typeof json.branch_overhead_annual === 'number')
        setBaselineBranchOverhead(json.branch_overhead_annual)
      if (typeof json.corporate_overhead_pct === 'number')
        setBaselineCorporateOverhead(json.corporate_overhead_pct)
    } catch {
      /* ignore */
    }
  }, [accountId, getToken])

  // ─── Initial load: account + latest analysis per module + properties for map ───
  const loadEverything = useCallback(async () => {
    if (!accountId) return
    setMapLoading(true)
    try {
      const token = await getToken()
      const headers = { Authorization: `Bearer ${token}` }

      const [accRes, analysesRes, propsRes] = await Promise.all([
        fetch(`/api/v1/accounts/${accountId}`, { headers }),
        fetch(`/api/analyses/account/${accountId}/latest`, { headers }).catch(() => null),
        loadAccountProperties(accountId, token),
      ])

      if (accRes.ok) setAccount(await accRes.json())

      const byModule: Record<string, AnalysisRow | null> = {
        geographic_distribution: null,
        branch_optimization: null,
        drive_time_logistics: null,
        crew_strategy: null,
        workforce_sizing: null,
        seasonality_capacity: null,
        bid_pricing_structure: null,
      }
      if (analysesRes && analysesRes.ok) {
        const rows: AnalysisRow[] = await analysesRes.json()
        for (const r of rows) {
          if (!byModule[r.module_key] || (byModule[r.module_key]?.created_at ?? '') < r.created_at) {
            byModule[r.module_key] = r
          }
        }
      }
      setLatestByModule(byModule)

      // If a row from a previous session is still 'running', resume polling
      // and seed startedAt from the row's created_at so elapsed time + stuck
      // detection work correctly.
      const resumePolls: Record<string, string> = {}
      const resumeStarted: Record<string, number> = {}
      const resumeRunning: Record<string, boolean> = {}
      for (const [k, r] of Object.entries(byModule)) {
        if (r && (r.status === 'running' || r.status === 'pending')) {
          resumePolls[k] = r.id
          resumeStarted[k] = new Date(r.created_at).getTime()
          resumeRunning[k] = true
        }
      }
      if (Object.keys(resumePolls).length) {
        setPollIds((prev) => ({ ...prev, ...resumePolls }))
        setStartedAt((prev) => ({ ...prev, ...resumeStarted }))
        setRunning((prev) => ({ ...prev, ...resumeRunning }))
      }

      // Hydrate map branches from the latest completed branch_optimization
      const bo = byModule.branch_optimization
      if (bo && bo.status === 'completed' && bo.outputs) {
        const recommended = bo.outputs.k_results?.find(
          (r: any) => r.k === bo.outputs.recommended_k
        )
        if (recommended) {
          setMapBranches(
            recommended.branches.map((b: any) => ({
              name: b.city_state,
              lat: b.lat,
              lng: b.lng,
              population: b.population ?? null,
              property_count: b.property_count ?? undefined,
            }))
          )
        }
      }

      setMapPoints(propsRes.points)
    } finally {
      setMapLoading(false)
    }
  }, [accountId, getToken])

  useEffect(() => {
    loadEverything()
    refreshConstraints()
  }, [loadEverything, refreshConstraints])

  // ─── Build-selection modal handlers ───
  const openBuildModal = useCallback(
    (k: number) => {
      const bo = latestByModule.branch_optimization
      const centroids: ReferenceCentroid[] = []
      let sourceId: string | null = null
      if (bo?.outputs?.k_results) {
        const row = bo.outputs.k_results.find((r: any) => r.k === k)
        if (row?.branches) {
          for (const b of row.branches as any[]) {
            centroids.push({
              city_state: b.city_state,
              lat: b.lat,
              lng: b.lng,
              property_count: b.property_count,
              locked: !!b.locked,
            })
          }
          sourceId = bo.id ?? null
        }
      }
      setModalK(k)
      setModalCentroids(centroids)
      setModalSourceAnalysisId(sourceId)
      setModalOpen(true)
    },
    [latestByModule]
  )

  const handleConfirmSelection = useCallback(
    async (payload: {
      k: number
      branches: SelectedBranch[]
      source_analysis_id: string | null
    }) => {
      if (!accountId) return
      const token = await getToken()
      const res = await fetch(`/api/accounts/${accountId}/select-branches`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }
      setSelectedBranches(json.selected_branches ?? null)
      setSelectedK(json.selected_k ?? null)
      setSelectedAt(json.selected_at ?? null)
      setSelectedFromAnalysisId(json.selected_from_analysis_id ?? null)
      setConstraintsUpdatedAt(json.updated_at ?? null)
      setModalOpen(false)
    },
    [accountId, getToken]
  )

  const handleClearSelection = useCallback(async () => {
    if (!accountId) return
    const token = await getToken()
    const res = await fetch(`/api/accounts/${accountId}/select-branches`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    const json = await res.json().catch(() => ({}))
    setSelectedBranches(json.selected_branches ?? null)
    setSelectedK(json.selected_k ?? null)
    setSelectedAt(json.selected_at ?? null)
    setSelectedFromAnalysisId(json.selected_from_analysis_id ?? null)
    setConstraintsUpdatedAt(json.updated_at ?? null)
  }, [accountId, getToken])

  const hasSelection = !!selectedBranches && selectedBranches.length > 0

  // ─── Tick every 1s so elapsed-time displays + stuck-state derivation refresh
  // even between polls. Only ticks while something is running. ───
  useEffect(() => {
    if (Object.keys(pollIds).length === 0) return
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [pollIds])

  // ─── Polling: GET /api/analyses/[id] every 3s for each running id ───
  const pollOnce = useCallback(
    async (moduleKey: string, id: string) => {
      try {
        const token = await getToken()
        const res = await fetch(`/api/analyses/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) {
          setLastPollError((prev) => ({
            ...prev,
            [moduleKey]: `HTTP ${res.status} ${res.statusText}`,
          }))
          return
        }
        const row: AnalysisRow = await res.json()
        setLastPolledAt((prev) => ({ ...prev, [moduleKey]: Date.now() }))
        setLastPollError((prev) => ({ ...prev, [moduleKey]: null }))

        if (row.status === 'completed' || row.status === 'failed') {
          setLatestByModule((prev) => ({ ...prev, [moduleKey]: row }))
          setRunning((prev) => ({ ...prev, [moduleKey]: false }))
          setPollIds((prev) => {
            const next = { ...prev }
            delete next[moduleKey]
            return next
          })
          if (
            row.status === 'completed' &&
            row.module_key === 'branch_optimization' &&
            row.outputs
          ) {
            const recommended = row.outputs.k_results?.find(
              (r: any) => r.k === row.outputs.recommended_k
            )
            if (recommended) {
              setMapBranches(
                recommended.branches.map((b: any) => ({
                  name: b.city_state,
                  lat: b.lat,
                  lng: b.lng,
                  population: b.population ?? null,
                  property_count: b.property_count ?? undefined,
                }))
              )
            }
          }
        }
      } catch (err: any) {
        setLastPollError((prev) => ({
          ...prev,
          [moduleKey]: err?.message ?? String(err),
        }))
      }
    },
    [getToken]
  )

  useEffect(() => {
    const ids = Object.entries(pollIds)
    if (ids.length === 0) return
    const interval = setInterval(() => {
      for (const [moduleKey, id] of ids) {
        pollOnce(moduleKey, id)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [pollIds, pollOnce])

  const runModule = useCallback(
    async (moduleKey: ModuleKey, endpoint: string) => {
      if (!accountId) return
      const startTs = Date.now()
      setStartedAt((prev) => ({ ...prev, [moduleKey]: startTs }))
      setLastPolledAt((prev) => ({ ...prev, [moduleKey]: null }))
      setLastPollError((prev) => ({ ...prev, [moduleKey]: null }))
      setRunning((prev) => ({ ...prev, [moduleKey]: true }))

      try {
        const token = await getToken()
        const res = await fetch(`/api/analyses/account/${accountId}/${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({}),
        })

        // The endpoint now does the work synchronously and writes the row to a
        // terminal state before responding. Body is { analysis_id, status, ...}.
        const data = await res.json().catch(() => ({} as any))
        const id = data.analysis_id as string | undefined

        if (!res.ok) {
          // The server may have written status='failed' to the row; pick that
          // up by fetching the row, but fall back to a synthetic error display.
          if (id) {
            const rowRes = await fetch(`/api/analyses/${id}`, {
              headers: { Authorization: `Bearer ${token}` },
            })
            if (rowRes.ok) {
              const row: AnalysisRow = await rowRes.json()
              setLatestByModule((prev) => ({ ...prev, [moduleKey]: row }))
            }
          } else {
            setLatestByModule((prev) => ({
              ...prev,
              [moduleKey]: {
                id: '',
                account_id: accountId,
                module_key: moduleKey,
                status: 'failed',
                outputs: null,
                summary_text: null,
                property_count: null,
                created_at: new Date().toISOString(),
                completed_at: new Date().toISOString(),
                error_message: data.error ?? `HTTP ${res.status} ${res.statusText}`,
              },
            }))
          }
          setRunning((prev) => ({ ...prev, [moduleKey]: false }))
          return
        }

        // Success path. With sync endpoints we usually get status='completed'
        // straight back; fetch the row to pick up summary_text + outputs.
        if (id) {
          const rowRes = await fetch(`/api/analyses/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (rowRes.ok) {
            const row: AnalysisRow = await rowRes.json()
            setLatestByModule((prev) => ({ ...prev, [moduleKey]: row }))
            if (
              row.status === 'completed' &&
              row.module_key === 'branch_optimization' &&
              row.outputs
            ) {
              const recommended = row.outputs.k_results?.find(
                (r: any) => r.k === row.outputs.recommended_k
              )
              if (recommended) {
                setMapBranches(
                  recommended.branches.map((b: any) => ({
                    name: b.city_state,
                    lat: b.lat,
                    lng: b.lng,
                    population: b.population ?? null,
                    property_count: b.property_count ?? undefined,
                  }))
                )
              }
            }
          }
        }

        // If for any reason the row is still 'running' (shouldn't happen with
        // sync endpoints, but defensive), drop into the polling path.
        if (data.status === 'running' && id) {
          setPollIds((prev) => ({ ...prev, [moduleKey]: id }))
        } else {
          setRunning((prev) => ({ ...prev, [moduleKey]: false }))
        }
      } catch (err: any) {
        setLatestByModule((prev) => ({
          ...prev,
          [moduleKey]: {
            id: '',
            account_id: accountId,
            module_key: moduleKey,
            status: 'failed',
            outputs: null,
            summary_text: null,
            property_count: null,
            created_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            error_message: err?.message ?? String(err),
          },
        }))
        setRunning((prev) => ({ ...prev, [moduleKey]: false }))
      }
    },
    [accountId, getToken]
  )

  const runAll = useCallback(async () => {
    // Endpoints are synchronous now — runModule resolves only when the work
    // is done — so a plain sequential loop is enough. Tier 2 modules are
    // skipped automatically when no branch selection exists.
    for (const m of MODULES) {
      if (TIER_2_MODULES.has(m.key) && !hasSelection) continue
      // eslint-disable-next-line no-await-in-loop
      await runModule(m.key, m.endpoint)
    }
  }, [runModule, hasSelection])

  const handleCheckNow = useCallback(
    (moduleKey: string) => {
      const id = pollIds[moduleKey]
      if (!id) return
      pollOnce(moduleKey, id)
    },
    [pollIds, pollOnce]
  )

  const handleMarkFailed = useCallback(
    async (moduleKey: string) => {
      const id = pollIds[moduleKey] ?? latestByModule[moduleKey]?.id
      if (!id) return
      try {
        const token = await getToken()
        const res = await fetch(`/api/analyses/${id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            status: 'failed',
            error_message: 'Marked stuck by user from dashboard',
          }),
        })
        if (res.ok) {
          const row: AnalysisRow = await res.json()
          setLatestByModule((prev) => ({ ...prev, [moduleKey]: row }))
        }
      } finally {
        setRunning((prev) => ({ ...prev, [moduleKey]: false }))
        setPollIds((prev) => {
          const next = { ...prev }
          delete next[moduleKey]
          return next
        })
      }
    },
    [pollIds, latestByModule, getToken]
  )

  const handleReassessRisk = useCallback(async () => {
    if (!accountId) return
    setReassessing(true)
    setReassessMessage(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/analyses/account/${accountId}/risk-flags-bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => ({} as any))
      if (!res.ok) {
        setReassessMessage(`Failed: ${data.error ?? res.statusText}`)
      } else {
        setReassessMessage(
          `Assessed ${data.total ?? 0} properties (${data.succeeded ?? 0} succeeded, ${data.failed ?? 0} failed).`
        )
        const refreshed = await loadAccountProperties(accountId, token)
        setMapPoints(refreshed.points)
      }
    } catch (err: any) {
      setReassessMessage(`Error: ${err?.message ?? String(err)}`)
    } finally {
      setReassessing(false)
    }
  }, [accountId, getToken])

  const statusFor = (key: ModuleKey): AnalysisStatus => {
    const r = latestByModule[key]
    const start = startedAt[key]
    const isRunning = running[key] || r?.status === 'running' || r?.status === 'pending'

    if (isRunning) {
      // Stuck detection: still 'running' past the threshold means the work
      // never wrote a terminal state (Vercel killed a fire-and-forget task,
      // or the row predates the sync-endpoints fix).
      const elapsed = start ? Date.now() - start : 0
      if (elapsed > STUCK_AFTER_MS) return 'stuck'
      return 'running'
    }
    if (!r) return 'idle'
    if (r.status === 'failed') return 'failed'
    if (r.status === 'completed') return 'completed'
    return 'idle'
  }

  const renderModuleBody = (key: ModuleKey) => {
    const row = latestByModule[key]
    if (!row || row.status !== 'completed' || !row.outputs) return null
    if (key === 'geographic_distribution') return <GeographicChart data={row.outputs} />
    if (key === 'branch_optimization')
      return (
        <BranchOptimizationChart
          data={row.outputs}
          showTable={!hasSelection}
          onBuild={openBuildModal}
          selectedK={selectedK}
          selectedBranchNames={selectedBranches?.map((b) => b.city_state || b.name) ?? null}
        />
      )
    if (key === 'drive_time_logistics') return <DriveTimeChart data={row.outputs} />
    if (key === 'crew_strategy') return <CrewStrategyChart data={row.outputs} />
    if (key === 'workforce_sizing') return <WorkforceSizingChart data={row.outputs} />
    if (key === 'seasonality_capacity') return <SeasonalityChart data={row.outputs} />
    if (key === 'bid_pricing_structure') return <BidPricingChart data={row.outputs} />
    return null
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <Navbar />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">

          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <Link to={`/accounts/${accountId}`} className="text-sm text-blue-600 hover:underline">
                ← Back to account
              </Link>
              <h1 className="text-2xl font-bold text-gray-900 mt-1">
                Smart Analysis
                {account && <span className="text-gray-500 font-normal"> · {account.display_name ?? account.name}</span>}
              </h1>
              {account && (
                <p className="text-sm text-gray-500 mt-1">
                  {account.stats.service_location_count} service locations across{' '}
                  {account.stats.client_count} clients
                </p>
              )}
            </div>
            <Button onClick={runAll} disabled={Object.values(running).some(Boolean)}>
              Run All Analyses
            </Button>
          </div>

          {/* Operational Constraints panel */}
          {accountId && (
            <OperationalConstraintsPanel
              accountId={accountId}
              onUpdatedAtChange={(iso) => {
                setConstraintsUpdatedAt(iso)
                refreshConstraints()
              }}
              onSaved={() => refreshConstraints()}
            />
          )}

          {/* Branch selection status banner — only when a selection exists */}
          {hasSelection && selectedBranches && (
            <SelectionStatusBanner
              branches={selectedBranches}
              selectedAt={selectedAt}
              selectedFromAnalysisId={selectedFromAnalysisId}
              onChangeSelection={handleClearSelection}
            />
          )}

          {/* Cost assumptions panel — collapsible, sits above Synthesis */}
          {accountId && (
            <CostAssumptionsPanel
              accountId={accountId}
              highlightGroup={costPanelHighlight}
              onSaved={() => refreshConstraints()}
            />
          )}

          {/* Synthesis card */}
          {accountId && (
            <SynthesisCard
              accountId={accountId}
              hasSelection={hasSelection}
              latestModuleCompletedAts={MODULES.map(
                (m) => latestByModule[m.key]?.completed_at ?? null
              )}
            />
          )}

          {/* Scenario sliders panel */}
          {accountId && (
            <ScenarioPanel
              accountId={accountId}
              hasSelection={hasSelection}
              baselineLaborCost={baselineLaborCost}
              baselineFuelCost={baselineFuelCost}
              baselineMargin={baselineMargin}
              baselineSurgePremium={baselineSurgePremium}
              selectedBranches={selectedBranches}
              selectedK={selectedK}
            />
          )}

          {/* Map snippet */}
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">Portfolio map</h3>
                <p className="text-xs text-gray-500">
                  Pins color-coded by risk score · house icons mark recommended branches.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleReassessRisk}
                loading={reassessing}
                disabled={reassessing}
              >
                Re-assess risk
              </Button>
            </div>
            {reassessMessage && (
              <div
                className={`px-5 py-2 text-xs border-b ${
                  reassessMessage.startsWith('Failed') || reassessMessage.startsWith('Error')
                    ? 'bg-red-50 text-red-700'
                    : 'bg-green-50 text-green-700'
                }`}
              >
                {reassessMessage}
              </div>
            )}
            <div className="p-4">
              {mapLoading ? (
                <div className="text-sm text-gray-400 py-12 text-center">Loading map…</div>
              ) : mapPoints.length === 0 ? (
                <div className="text-sm text-gray-400 py-12 text-center">
                  No properties found for this account.
                </div>
              ) : (
                <AnalysisMap
                  points={mapPoints}
                  branches={mapBranches}
                  height={360}
                  colorMode={mapColorMode}
                />
              )}

              {/* Color mode toggle (only meaningful when branches are selected) */}
              {hasSelection && mapBranches.length > 0 && (
                <div className="flex items-center gap-3 text-xs text-gray-600 mt-3 flex-wrap">
                  <span className="font-semibold uppercase tracking-wide text-gray-500">
                    Color by:
                  </span>
                  {(
                    [
                      ['branch', 'Branch assignment'],
                      ['risk', 'Risk score'],
                      ['both', 'Both (fill = branch · border = risk)'],
                    ] as Array<[ColorMode, string]>
                  ).map(([mode, label]) => (
                    <label key={mode} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="map-color-mode"
                        checked={mapColorMode === mode}
                        onChange={() => setMapColorMode(mode)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              )}

              {/* Legend — branch clusters when applicable, otherwise risk colors */}
              {hasSelection && mapBranches.length > 0 && mapColorMode !== 'risk' ? (
                <div className="flex items-center gap-3 text-xs text-gray-600 mt-3 flex-wrap">
                  {mapBranches.map((b, i) => {
                    const count = mapPoints.length
                      ? mapPoints.filter((p) => nearestBranchIdx(p, mapBranches) === i).length
                      : 0
                    return (
                      <LegendDot
                        key={i}
                        color={colorForBranchIndex(i)}
                        label={`${b.name} · ${count}`}
                      />
                    )
                  })}
                </div>
              ) : (
                <div className="flex items-center gap-3 text-xs text-gray-500 mt-3 flex-wrap">
                  <LegendDot color="#22c55e" label="Low / no risk" />
                  <LegendDot color="#facc15" label="Mild" />
                  <LegendDot color="#f97316" label="Elevated" />
                  <LegendDot color="#dc2626" label="High" />
                  <LegendDot color="#9ca3af" label="Not assessed" />
                </div>
              )}
            </div>
          </div>

          {/* Module cards */}
          <div className="grid grid-cols-1 gap-4">
            {MODULES.map((m) => {
              const row = latestByModule[m.key]
              const status = statusFor(m.key)
              const stale =
                !!constraintsUpdatedAt &&
                !!row?.completed_at &&
                new Date(row.completed_at) < new Date(constraintsUpdatedAt)
              const isTier2 = TIER_2_MODULES.has(m.key)
              const disabledReason =
                isTier2 && !hasSelection
                  ? 'Select branches in Branch Optimization to enable this analysis'
                  : null
              const description =
                isTier2 && hasSelection
                  ? `${m.description} · Using K=${selectedK ?? selectedBranches?.length ?? '?'} selected branches`
                  : m.description
              const usingMeta = usingLineForModule(m.key, {
                laborCost: baselineLaborCost,
                hoursPerDay: baselineHoursPerDay,
                workingDays: baselineWorkingDays,
                fuelCost: baselineFuelCost,
                driveSpeed: baselineDriveSpeed,
                maxDriveMin: baselineMaxDriveMin,
                productivity: baselineProductivity,
                branchOverhead: baselineBranchOverhead,
                corporateOverhead: baselineCorporateOverhead,
                margin: baselineMargin,
              })
              return (
                <AnalysisCard
                  key={m.key}
                  title={m.title}
                  description={description}
                  status={status}
                  completedAt={row?.completed_at ?? null}
                  errorMessage={row?.status === 'failed' ? row.error_message : null}
                  summary={row?.status === 'completed' ? row.summary_text : null}
                  onRun={() => runModule(m.key, m.endpoint)}
                  running={running[m.key]}
                  startedAt={startedAt[m.key] ?? null}
                  lastPolledAt={lastPolledAt[m.key] ?? null}
                  lastPollError={lastPollError[m.key] ?? null}
                  analysisId={pollIds[m.key] ?? row?.id ?? null}
                  onCheckNow={pollIds[m.key] ? () => handleCheckNow(m.key) : undefined}
                  onMarkFailed={status === 'stuck' ? () => handleMarkFailed(m.key) : undefined}
                  staleVsConstraints={stale}
                  disabledReason={disabledReason}
                  usingLine={usingMeta?.line}
                  onEditAssumptions={
                    usingMeta?.group
                      ? () => setCostPanelHighlight(usingMeta.group + '#' + Date.now())
                      : undefined
                  }
                >
                  {renderModuleBody(m.key)}
                </AnalysisCard>
              )
            })}
          </div>

          {/* Chat panel — floating button, expands to drawer */}
          {accountId && <ChatPanel accountId={accountId} />}

          {/* Build-selection modal */}
          {modalOpen && (
            <BuildSelectionModal
              open={modalOpen}
              onClose={() => setModalOpen(false)}
              k={modalK}
              existingBranches={existingBranches}
              referenceCentroids={modalCentroids}
              sourceAnalysisId={modalSourceAnalysisId}
              onConfirm={handleConfirmSelection}
            />
          )}

        </div>
      </div>
    </div>
  )
}

// Phase 3.5 — per-module "Using: …" line + which Cost Assumptions group to
// scroll to when the user clicks "[Edit assumptions]". Returns null for
// modules that don't materially depend on cost assumptions.
function usingLineForModule(
  key: ModuleKey,
  v: {
    laborCost: number
    hoursPerDay: number
    workingDays: number
    fuelCost: number
    driveSpeed: number
    maxDriveMin: number
    productivity: number
    branchOverhead: number
    corporateOverhead: number
    margin: number
  }
): { line: React.ReactNode; group: string } | null {
  const fmtMoney = (n: number) =>
    n >= 1000 ? `$${(n / 1000).toFixed(0)}K` : `$${n.toFixed(2)}`
  const fmtPct = (n: number) => `${(n * 100).toFixed(0)}%`
  const dot = ' · '
  switch (key) {
    case 'branch_optimization':
      return {
        line: `${fmtMoney(v.fuelCost)}/mile fuel${dot}${v.driveSpeed} mph drive speed${dot}${fmtMoney(v.branchOverhead)}/branch overhead`,
        group: 'Vehicle & Fuel',
      }
    case 'drive_time_logistics':
      return {
        line: `${v.driveSpeed} mph drive speed${dot}max ${v.maxDriveMin} min one-way`,
        group: 'Vehicle & Fuel',
      }
    case 'crew_strategy':
      return {
        line: `$${v.laborCost.toFixed(2)}/hr labor${dot}${v.hoursPerDay} hr/day${dot}${v.workingDays} days/year${dot}$${v.fuelCost.toFixed(3)}/mile fuel`,
        group: 'Crew Economics',
      }
    case 'workforce_sizing':
      return {
        line: `${v.productivity.toLocaleString()} sqft/hr productivity${dot}$${v.laborCost.toFixed(2)}/hr labor`,
        group: 'Productivity Rules',
      }
    case 'seasonality_capacity':
      return {
        line: `${v.hoursPerDay} hr/day${dot}${v.workingDays} days/year`,
        group: 'Crew Economics',
      }
    case 'bid_pricing_structure':
      return {
        line: `${fmtMoney(v.branchOverhead)}/branch overhead${dot}${fmtPct(v.corporateOverhead)} corp overhead${dot}${fmtPct(v.margin)} margin`,
        group: 'Branch & Operational Costs',
      }
    default:
      return null
  }
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: color }} />
      {label}
    </span>
  )
}

// Cheap haversine for the legend's per-branch property counts. Lives here
// (rather than inside the AnalysisMap component) so we don't recompute the
// same nearest-branch lookup twice — the map already does it for coloring.
function nearestBranchIdx(
  pt: { lat: number; lng: number },
  branches: AnalysisMapBranch[]
): number | null {
  if (!branches.length) return null
  let bestIdx = 0
  let bestDist = Infinity
  for (let i = 0; i < branches.length; i++) {
    const dLat = ((branches[i].lat - pt.lat) * Math.PI) / 180
    const dLng = ((branches[i].lng - pt.lng) * Math.PI) / 180
    const lat1 = (pt.lat * Math.PI) / 180
    const lat2 = (branches[i].lat * Math.PI) / 180
    const h =
      Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
    const d = 2 * 3958.7613 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
    if (d < bestDist) {
      bestDist = d
      bestIdx = i
    }
  }
  return bestIdx
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: load account properties via the existing /api/v1/properties endpoint,
// using the account's clients as the filter. Pulls risk_score for color coding.
// ─────────────────────────────────────────────────────────────────────────────
async function loadAccountProperties(
  accountId: string,
  token: string | null
): Promise<{ points: AnalysisMapPoint[]; branches: AnalysisMapBranch[] }> {
  const headers = { Authorization: `Bearer ${token ?? ''}` }

  // Get the account's clients
  const clientsRes = await fetch(`/api/v1/clients?account_id=${accountId}`, { headers })
  if (!clientsRes.ok) return { points: [], branches: [] }
  const clients = (await clientsRes.json()) as Array<{ id: string }>
  if (!clients.length) return { points: [], branches: [] }

  const clientIdParam = clients.map((c) => c.id).join(',')
  const propsRes = await fetch(
    `/api/v1/properties?client_id=${encodeURIComponent(clientIdParam)}&limit=2000`,
    { headers }
  )
  if (!propsRes.ok) return { points: [], branches: [] }
  const data = await propsRes.json()
  const points: AnalysisMapPoint[] = (data.properties ?? [])
    .filter((p: any) => p.latitude != null && p.longitude != null)
    .map((p: any) => ({
      id: p.property_id ?? p.id,
      lat: p.latitude,
      lng: p.longitude,
      risk_score: p.risk_score ?? null,
    }))

  return { points, branches: [] }
}
