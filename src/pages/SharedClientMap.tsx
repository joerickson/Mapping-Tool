import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import AnalysisMap from '../components/analysis/AnalysisMap'
import type { AnalysisMapPoint, AnalysisMapBranch } from '../components/analysis/AnalysisMap'
import { colorForBranchIndex } from '../lib/branch-colors.js'

interface SharedClientData {
  client: { name: string; display_name: string | null; brand_color: string | null }
  points: AnalysisMapPoint[]
  branches: AnalysisMapBranch[]
}

export default function SharedClientMapPage() {
  const { shareToken } = useParams<{ shareToken: string }>()
  const [data, setData] = useState<SharedClientData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      if (!shareToken) return
      setLoading(true)
      try {
        const res = await fetch(`/api/v1/shared-clients/${encodeURIComponent(shareToken)}`)
        if (!res.ok) {
          setError(
            res.status === 404 || res.status === 410
              ? 'This link is unavailable or has expired.'
              : 'Failed to load map.'
          )
          return
        }
        const json = await res.json()
        setData({
          client: json.client,
          points: json.points ?? [],
          branches: json.branches ?? [],
        })
      } catch {
        setError('Failed to load map.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [shareToken])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading map...</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">🗺️</div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">Link Unavailable</h1>
          <p className="text-gray-500">{error ?? 'This link is unavailable or has expired.'}</p>
        </div>
      </div>
    )
  }

  const { client, points, branches } = data
  const title = client.display_name ?? client.name

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-6 py-4">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        <AnalysisMap points={points} branches={branches} colorMode="branch" height={600} />

        {branches.length > 0 && (
          <div className="bg-white rounded-xl border shadow-sm px-6 py-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Branches</h2>
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {branches.map((b, i) => (
                <li key={`${b.name}-${i}`} className="flex items-center gap-2 text-sm text-gray-700">
                  <span
                    className="inline-block w-3 h-3 rounded-full"
                    style={{ backgroundColor: colorForBranchIndex(i) }}
                  />
                  {b.name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
