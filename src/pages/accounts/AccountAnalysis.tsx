import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import Navbar from '../../components/ui/Navbar'
import Button from '../../components/ui/Button'
import AnalysisCard, { type AnalysisStatus } from '../../components/analysis/AnalysisCard'
import GeographicChart from '../../components/analysis/GeographicChart'
import BranchOptimizationChart from '../../components/analysis/BranchOptimizationChart'
import DriveTimeChart from '../../components/analysis/DriveTimeChart'
import AnalysisMap, {
  type AnalysisMapPoint,
  type AnalysisMapBranch,
} from '../../components/analysis/AnalysisMap'

type ModuleKey = 'geographic_distribution' | 'branch_optimization' | 'drive_time_logistics'

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
  const [mapPoints, setMapPoints] = useState<AnalysisMapPoint[]>([])
  const [mapBranches, setMapBranches] = useState<AnalysisMapBranch[]>([])
  const [mapLoading, setMapLoading] = useState(true)
  const [reassessing, setReassessing] = useState(false)

  const accountIdRef = useRef(accountId)
  useEffect(() => {
    accountIdRef.current = accountId
  }, [accountId])

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
        // pull this account's properties via clients filter, with extra fields
        loadAccountProperties(accountId, token),
      ])

      if (accRes.ok) setAccount(await accRes.json())

      // Latest analysis row per module — derived directly from properties query if the dedicated route doesn't exist
      const byModule: Record<string, AnalysisRow | null> = {
        geographic_distribution: null,
        branch_optimization: null,
        drive_time_logistics: null,
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

      setMapPoints(propsRes.points)
      setMapBranches(propsRes.branches)
    } finally {
      setMapLoading(false)
    }
  }, [accountId, getToken])

  useEffect(() => {
    loadEverything()
  }, [loadEverything])

  // ─── Polling: for each running analysis_id, hit GET /api/analyses/[id] every 3s ───
  useEffect(() => {
    const ids = Object.entries(pollIds)
    if (ids.length === 0) return

    const interval = setInterval(async () => {
      const token = await getToken()
      for (const [moduleKey, id] of ids) {
        try {
          const res = await fetch(`/api/analyses/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (!res.ok) continue
          const row: AnalysisRow = await res.json()
          if (row.status === 'completed' || row.status === 'failed') {
            setLatestByModule((prev) => ({ ...prev, [moduleKey]: row }))
            setRunning((prev) => ({ ...prev, [moduleKey]: false }))
            setPollIds((prev) => {
              const next = { ...prev }
              delete next[moduleKey]
              return next
            })
            // If branch_optimization just completed, refresh the map branches
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
        } catch {
          /* swallow — retry next tick */
        }
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [pollIds, getToken])

  const runModule = useCallback(
    async (moduleKey: ModuleKey, endpoint: string) => {
      if (!accountId) return
      setRunning((prev) => ({ ...prev, [moduleKey]: true }))
      try {
        const token = await getToken()
        const res = await fetch(`/api/analyses/${accountId}/${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({}),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          alert(`Failed to start ${moduleKey}: ${err.error ?? res.statusText}`)
          setRunning((prev) => ({ ...prev, [moduleKey]: false }))
          return
        }
        const data = await res.json()
        const id = data.analysis_id as string
        if (data.status === 'completed' && data.cached) {
          // Cached hit: fetch the row immediately
          const rowRes = await fetch(`/api/analyses/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (rowRes.ok) {
            const row: AnalysisRow = await rowRes.json()
            setLatestByModule((prev) => ({ ...prev, [moduleKey]: row }))
          }
          setRunning((prev) => ({ ...prev, [moduleKey]: false }))
        } else {
          // Start polling
          setPollIds((prev) => ({ ...prev, [moduleKey]: id }))
        }
      } catch (err: any) {
        alert(`Error: ${err.message ?? String(err)}`)
        setRunning((prev) => ({ ...prev, [moduleKey]: false }))
      }
    },
    [accountId, getToken]
  )

  const runAll = useCallback(async () => {
    // Sequential — Branch Opt depends on nothing, but Drive Time benefits from
    // a fresh Branch Opt result, so run them in declared order.
    for (const m of MODULES) {
      // eslint-disable-next-line no-await-in-loop
      await runModule(m.key, m.endpoint)
      // wait for polling to clear before starting the next
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (!runningRef.current[m.key]) {
            clearInterval(check)
            resolve()
          }
        }, 500)
      })
    }
  }, [runModule])

  // Need a ref for runAll's polling-completion check
  const runningRef = useRef(running)
  useEffect(() => {
    runningRef.current = running
  }, [running])

  const handleReassessRisk = useCallback(async () => {
    if (!accountId) return
    setReassessing(true)
    try {
      const token = await getToken()
      await fetch(`/api/analyses/${accountId}/risk-flags-bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      })
      // Risk-flags-bulk runs in the background. Refresh the map points after a delay.
      setTimeout(async () => {
        const refreshed = await loadAccountProperties(accountId, token)
        setMapPoints(refreshed.points)
        setReassessing(false)
      }, 8000)
    } catch (err) {
      setReassessing(false)
    }
  }, [accountId, getToken])

  const statusFor = (key: ModuleKey): AnalysisStatus => {
    if (running[key]) return 'running'
    const r = latestByModule[key]
    if (!r) return 'idle'
    if (r.status === 'failed') return 'failed'
    if (r.status === 'completed') return 'completed'
    if (r.status === 'running' || r.status === 'pending') return 'running'
    return 'idle'
  }

  const renderModuleBody = (key: ModuleKey) => {
    const row = latestByModule[key]
    if (!row || row.status !== 'completed' || !row.outputs) return null
    if (key === 'geographic_distribution') return <GeographicChart data={row.outputs} />
    if (key === 'branch_optimization') return <BranchOptimizationChart data={row.outputs} />
    if (key === 'drive_time_logistics') return <DriveTimeChart data={row.outputs} />
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
              return (
                <AnalysisCard
                  key={m.key}
                  title={m.title}
                  description={m.description}
                  status={statusFor(m.key)}
                  completedAt={row?.completed_at ?? null}
                  errorMessage={row?.status === 'failed' ? row.error_message : null}
                  summary={row?.status === 'completed' ? row.summary_text : null}
                  onRun={() => runModule(m.key, m.endpoint)}
                  running={running[m.key]}
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
