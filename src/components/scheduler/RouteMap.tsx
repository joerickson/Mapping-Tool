// Phase 4c — minimal route map. Branch as a star marker, numbered stops,
// polyline tracing the route in order. Reuses Mapbox setup from
// AnalysisMap but with a different rendering pass (numbered pins + line).
import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN ?? ''

export interface RouteMapStop {
  sequence: number
  service_location_id: string
  lat: number
  lng: number
  address: string
}

interface Props {
  branch: { name: string; lat: number; lng: number }
  stops: RouteMapStop[]
  returnToBranch?: boolean
  height?: number
}

export default function RouteMap({
  branch,
  stops,
  returnToBranch = true,
  height = 480,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])

  useEffect(() => {
    if (!containerRef.current) return
    if (!mapboxgl.accessToken) return

    if (!mapRef.current) {
      mapRef.current = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/light-v11',
        center: [branch.lng, branch.lat],
        zoom: 8,
      })
    }
    const map = mapRef.current

    const render = () => {
      // Clear previous markers
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []

      // Branch marker (star-ish: large border, accent fill)
      const branchEl = document.createElement('div')
      branchEl.className =
        'flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-md'
      branchEl.style.backgroundColor = '#0f172a'
      branchEl.style.border = '2px solid #fff'
      branchEl.textContent = '★'
      branchEl.title = `Branch: ${branch.name}`
      markersRef.current.push(
        new mapboxgl.Marker({ element: branchEl })
          .setLngLat([branch.lng, branch.lat])
          .setPopup(new mapboxgl.Popup({ offset: 18 }).setHTML(`<strong>${branch.name}</strong><br/>Branch`))
          .addTo(map)
      )

      // Stop markers
      stops.forEach((s) => {
        const el = document.createElement('div')
        el.className =
          'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-md'
        el.style.backgroundColor = '#4f46e5'
        el.style.border = '2px solid #fff'
        el.textContent = String(s.sequence)
        markersRef.current.push(
          new mapboxgl.Marker({ element: el })
            .setLngLat([s.lng, s.lat])
            .setPopup(
              new mapboxgl.Popup({ offset: 16 }).setHTML(
                `<strong>Stop ${s.sequence}</strong><br/>${s.address}`
              )
            )
            .addTo(map)
        )
      })

      // Route line
      const coords: [number, number][] = [[branch.lng, branch.lat]]
      for (const s of stops) coords.push([s.lng, s.lat])
      if (returnToBranch && stops.length > 0) coords.push([branch.lng, branch.lat])

      if (map.getLayer('route-line')) map.removeLayer('route-line')
      if (map.getSource('route-line')) map.removeSource('route-line')

      if (coords.length >= 2) {
        map.addSource('route-line', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: coords },
          },
        })
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route-line',
          paint: {
            'line-color': '#4f46e5',
            'line-width': 3,
            'line-opacity': 0.7,
            'line-dasharray': [2, 1],
          },
        })
      }

      // Fit bounds to all coords
      if (coords.length > 1) {
        const bounds = coords.reduce(
          (b, [lng, lat]) => b.extend([lng, lat]),
          new mapboxgl.LngLatBounds(coords[0], coords[0])
        )
        map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 400 })
      }
    }

    if (map.loaded()) render()
    else map.once('load', render)
  }, [branch, stops, returnToBranch])

  useEffect(() => {
    return () => {
      markersRef.current.forEach((m) => m.remove())
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="rounded-md border border-border overflow-hidden"
      style={{ height }}
    />
  )
}
