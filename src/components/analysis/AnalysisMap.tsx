import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { BRANCH_PALETTE, colorForBranchIndex, colorForRiskScore } from '../../lib/branch-colors.js'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN ?? ''

export interface AnalysisMapPoint {
  id: string
  lat: number
  lng: number
  risk_score?: number | null
}

export interface AnalysisMapBranch {
  name: string
  lat: number
  lng: number
  population?: number | null
  property_count?: number
  utilization_pct?: number | null
}

export type ColorMode = 'branch' | 'risk' | 'both'

interface Props {
  points: AnalysisMapPoint[]
  branches?: AnalysisMapBranch[]
  height?: number
  // Phase 3.5 — color mode toggle. Defaults to 'branch' when branches are
  // present; falls back to a neutral single-color render otherwise.
  colorMode?: ColorMode
}

// Compute nearest-branch index per point (haversine, no need for full geo lib)
function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 3958.7613
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function nearestBranchIndex(
  pt: { lat: number; lng: number },
  branches: AnalysisMapBranch[]
): number | null {
  if (branches.length === 0) return null
  let bestIdx = 0
  let bestDist = Infinity
  for (let i = 0; i < branches.length; i++) {
    const d = haversineMiles(pt, branches[i])
    if (d < bestDist) {
      bestDist = d
      bestIdx = i
    }
  }
  return bestIdx
}

export default function AnalysisMap({
  points,
  branches = [],
  height = 320,
  colorMode = 'branch',
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    mapRef.current = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-98.5795, 39.8283],
      zoom: 3.5,
    })
    mapRef.current.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    return () => {
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const drawMarkers = () => {
      for (const m of markersRef.current) m.remove()
      markersRef.current = []

      const valid = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      if (valid.length === 0 && branches.length === 0) return

      const bounds = new mapboxgl.LngLatBounds()
      const useBranchColor = branches.length > 0 && (colorMode === 'branch' || colorMode === 'both')

      // Property dots
      for (const p of valid) {
        const idx = useBranchColor ? nearestBranchIndex({ lat: p.lat, lng: p.lng }, branches) : null
        const fill =
          colorMode === 'risk'
            ? colorForRiskScore(p.risk_score)
            : useBranchColor && idx != null
            ? colorForBranchIndex(idx)
            : colorForRiskScore(p.risk_score)

        const el = document.createElement('div')
        el.style.width = '10px'
        el.style.height = '10px'
        el.style.borderRadius = '999px'
        el.style.background = fill
        // In 'both' mode, use a thick outer border colored by risk so both
        // dimensions are visible at once.
        if (colorMode === 'both') {
          el.style.border = `2.5px solid ${colorForRiskScore(p.risk_score)}`
          el.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.15)'
        } else {
          el.style.border = '1.5px solid #ffffff'
          el.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.15)'
        }

        const marker = new mapboxgl.Marker(el).setLngLat([p.lng, p.lat]).addTo(map)
        markersRef.current.push(marker)
        bounds.extend([p.lng, p.lat])
      }

      // Branch markers — distinct shape (star) and color matching the cluster
      for (let i = 0; i < branches.length; i++) {
        const b = branches[i]
        const color = colorMode === 'branch' || colorMode === 'both'
          ? colorForBranchIndex(i)
          : '#1e3a8a'
        const el = document.createElement('div')
        el.style.cursor = 'pointer'
        el.innerHTML = renderStarSvg(color, 22)
        el.style.transform = 'translateY(-2px)'

        const popupBits: string[] = [escapeHtml(b.name)]
        if (typeof b.population === 'number')
          popupBits.push(`${formatPop(b.population)} pop`)
        if (typeof b.property_count === 'number')
          popupBits.push(`${b.property_count} properties`)
        if (typeof b.utilization_pct === 'number')
          popupBits.push(`${b.utilization_pct}% util`)

        const marker = new mapboxgl.Marker(el)
          .setLngLat([b.lng, b.lat])
          .setPopup(new mapboxgl.Popup({ offset: 14 }).setHTML(popupBits.join(' · ')))
          .addTo(map)
        markersRef.current.push(marker)
        bounds.extend([b.lng, b.lat])
      }

      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 40, maxZoom: 9, duration: 0 })
      }
    }

    if (map.loaded()) drawMarkers()
    else map.once('load', drawMarkers)
  }, [points, branches, colorMode])

  return (
    <div className="rounded-lg overflow-hidden border" style={{ height }}>
      <div ref={containerRef} className="w-full h-full" />
    </div>
  )
}

function renderStarSvg(color: string, size: number): string {
  // 5-point star — visually distinct from the round property dots
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24"
    fill="${color}" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round">
    <path d="M12 2.5l2.93 6.43 7.07.65-5.36 4.7 1.66 6.92L12 17.77l-6.3 3.43 1.66-6.92L2 9.58l7.07-.65L12 2.5z"/>
  </svg>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatPop(p: number): string {
  if (p >= 1_000_000) return `${(p / 1_000_000).toFixed(1)}M`
  if (p >= 1000) return `${(p / 1000).toFixed(0)}K`
  return p.toString()
}

export { BRANCH_PALETTE }
