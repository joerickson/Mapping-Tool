import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

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
}

interface Props {
  points: AnalysisMapPoint[]
  branches?: AnalysisMapBranch[]
  height?: number
}

function colorForScore(score: number | null | undefined): string {
  if (score == null) return '#9ca3af'
  if (score >= 6) return '#dc2626'
  if (score >= 3) return '#f97316'
  if (score >= 1) return '#facc15'
  return '#22c55e'
}

export default function AnalysisMap({ points, branches = [], height = 320 }: Props) {
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
      // clear existing markers
      for (const m of markersRef.current) m.remove()
      markersRef.current = []

      const valid = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      if (valid.length === 0) return

      const bounds = new mapboxgl.LngLatBounds()
      for (const p of valid) {
        const el = document.createElement('div')
        el.style.width = '10px'
        el.style.height = '10px'
        el.style.borderRadius = '999px'
        el.style.background = colorForScore(p.risk_score ?? null)
        el.style.border = '1.5px solid #ffffff'
        el.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.15)'
        const marker = new mapboxgl.Marker(el).setLngLat([p.lng, p.lat]).addTo(map)
        markersRef.current.push(marker)
        bounds.extend([p.lng, p.lat])
      }

      for (const b of branches) {
        const el = document.createElement('div')
        el.innerHTML =
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="#1e3a8a" stroke="#fff" stroke-width="2"><path d="M3 21h18v-9l-9-7-9 7v9zm6-6h6v6H9v-6z"/></svg>'
        el.style.transform = 'translateY(-2px)'
        const marker = new mapboxgl.Marker(el)
          .setLngLat([b.lng, b.lat])
          .setPopup(new mapboxgl.Popup({ offset: 12 }).setText(b.name))
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
  }, [points, branches])

  return (
    <div className="rounded-lg overflow-hidden border" style={{ height }}>
      <div ref={containerRef} className="w-full h-full" />
    </div>
  )
}
