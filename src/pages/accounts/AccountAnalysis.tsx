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
import AnalysisMap, {
  type AnalysisMapPoint,
  type AnalysisMapBranch,
} from '../../components/analysis/AnalysisMap'

type ModuleKey =
  | 'geographic_distribution'
  | 'branch_optimization'
  | 'drive_time_logistics'
  | 'crew_strategy'
  | 'workforce_sizing'
  | 'seasonality_capacity'
  | 'bid_pricing_structure'

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
  const [mapLoading, setMapLoading] = useState(true)
  const [reassessing, setReassessing] = useState(false)
  const [reassessMessage, setReassessMessage] = useState<string | null>(null)

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
  }, [loadEverything])

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
    // is done — so a plain sequential loop is enough.
    for (const m of MODULES) {
      // eslint-disable-next-line no-await-in-loop
      await runModule(m.key, m.endpoint)
    }
  }, [runModule])

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
    if (key === 'branch_optimization') return <BranchOptimizationChart data={row.outputs} />
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

          {/* Synthesis placeholder */}
          <div className="bg-white rounded-xl border shadow-sm px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">Portfolio Synthesis</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Unified analysis combining all module outputs with scenario sliders + chat.
                </p>
              </div>
              <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">Coming in Phase 3</span>
            </div>
          </div>

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
                <AnalysisMap points={mapPoints} branches={mapBranches} height={360} />
              )}
              <div className="flex items-center gap-3 text-xs text-gray-500 mt-3">
                <LegendDot color="#22c55e" label="Low / no risk" />
                <LegendDot color="#facc15" label="Mild" />
                <LegendDot color="#f97316" label="Elevated" />
                <LegendDot color="#dc2626" label="High" />
                <LegendDot color="#9ca3af" label="Not assessed" />
              </div>
            </div>
          </div>

          {/* Module cards */}
          <div className="grid grid-cols-1 gap-4">
            {MODULES.map((m) => {
              const row = latestByModule[m.key]
              const status = statusFor(m.key)
              return (
                <AnalysisCard
                  key={m.key}
                  title={m.title}
                  description={m.description}
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
                >
                  {renderModuleBody(m.key)}
                </AnalysisCard>
              )
            })}
          </div>

        </div>
      </div>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: color }} />
      {label}
    </span>
  )
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
