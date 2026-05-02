// Phase 4.5g — Map view of branch assignments.
// Renders branches with capacity circles and properties as colored
// dots (color = assigned branch). Click a property to override its
// assignment via the same /branch-overrides endpoint the list view
// uses. The capacity circles visualize each branch's nominal reach
// (cluster_radius_miles); overlapping circles indicate properties
// that could naturally go to either branch.
import { useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useAuth } from '../../hooks/useAuth'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN ?? ''

interface Branch { name: string; lat: number; lng: number }

interface Assignment {
  service_location_id: string
  property_id: string
  address: string
  lat: number
  lng: number
  nearest_branch_idx: number
  assigned_branch_idx: number
  transferred: boolean
  overridden: boolean
  is_remote?: boolean
}

interface Props {
  templateId: string
  branches: Branch[]
  assignments: Assignment[]
  overrides: Record<string, number>
  // Cluster radius in miles, used to draw the visual capacity circles.
  clusterRadiusMiles: number
  onChanged: () => void
}

// Distinct colors for branches. Looped if more branches than colors.
const BRANCH_COLORS = [
  '#4f46e5', // indigo
  '#0d9488', // teal
  '#dc2626', // red
  '#ea580c', // orange
  '#16a34a', // green
  '#9333ea', // purple
  '#0284c7', // sky
  '#a16207', // amber
]
const colorFor = (idx: number) => BRANCH_COLORS[idx % BRANCH_COLORS.length]

// 1 mile ≈ 1609.34 meters
const MILES_TO_METERS = 1609.34

// GeoJSON circle approximation around a center, in mi-radius.
function circlePolygon(
  center: { lat: number; lng: number },
  miles: number,
  steps = 64
): GeoJSON.Feature<GeoJSON.Polygon> {
  const ring: [number, number][] = []
  const earthRadius = 6371000 // meters
  const radiusM = miles * MILES_TO_METERS
  const lat = (center.lat * Math.PI) / 180
  const lng = (center.lng * Math.PI) / 180
  for (let i = 0; i <= steps; i++) {
    const bearing = (i / steps) * 2 * Math.PI
    const newLat = Math.asin(
      Math.sin(lat) * Math.cos(radiusM / earthRadius) +
        Math.cos(lat) * Math.sin(radiusM / earthRadius) * Math.cos(bearing)
    )
    const newLng =
      lng +
      Math.atan2(
        Math.sin(bearing) * Math.sin(radiusM / earthRadius) * Math.cos(lat),
        Math.cos(radiusM / earthRadius) - Math.sin(lat) * Math.sin(newLat)
      )
    ring.push([(newLng * 180) / Math.PI, (newLat * 180) / Math.PI])
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] },
  }
}

export default function BranchAssignmentsMap({
  templateId,
  branches,
  assignments,
  overrides,
  clusterRadiusMiles,
  onChanged,
}: Props) {
  const { getToken } = useAuth()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])
  const popupRef = useRef<mapboxgl.Popup | null>(null)
  const [selected, setSelected] = useState<Assignment | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const validAssignments = useMemo(
    () => assignments.filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lng)),
    [assignments]
  )

  // Assign override and reload upstream data on success.
  const setOverride = async (
    serviceLocationId: string,
    branchIdx: number | null
  ) => {
    setSaving(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(
        `/api/scheduler/templates/${templateId}/branch-overrides`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ service_location_id: serviceLocationId, branch_idx: branchIdx }),
        }
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as any).error ?? `HTTP ${res.status}`)
      }
      onChanged()
      setSelected(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  // Initialize map once.
  useEffect(() => {
    if (!containerRef.current || !mapboxgl.accessToken) return
    if (mapRef.current) return

    const center =
      branches.length > 0
        ? ([branches[0].lng, branches[0].lat] as [number, number])
        : ([-98, 39] as [number, number])

    mapRef.current = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center,
      zoom: 5,
    })
    mapRef.current.addControl(new mapboxgl.NavigationControl(), 'top-right')
  }, [branches])

  // Render branch circles + markers.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const addLayers = () => {
      // Remove any existing circle layers/sources.
      for (let i = 0; i < 20; i++) {
        const id = `branch-circle-${i}`
        if (map.getLayer(`${id}-fill`)) map.removeLayer(`${id}-fill`)
        if (map.getLayer(`${id}-line`)) map.removeLayer(`${id}-line`)
        if (map.getSource(id)) map.removeSource(id)
      }

      // Add a capacity circle per branch.
      branches.forEach((b, i) => {
        const id = `branch-circle-${i}`
        const data = circlePolygon({ lat: b.lat, lng: b.lng }, clusterRadiusMiles)
        map.addSource(id, { type: 'geojson', data })
        map.addLayer({
          id: `${id}-fill`,
          type: 'fill',
          source: id,
          paint: {
            'fill-color': colorFor(i),
            'fill-opacity': 0.08,
          },
        })
        map.addLayer({
          id: `${id}-line`,
          type: 'line',
          source: id,
          paint: {
            'line-color': colorFor(i),
            'line-width': 1.5,
            'line-opacity': 0.5,
          },
        })
      })
    }

    if (map.loaded()) addLayers()
    else map.once('load', addLayers)
  }, [branches, clusterRadiusMiles])

  // Render branch + property markers.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const render = () => {
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []

      // Branch markers (star)
      branches.forEach((b, i) => {
        const el = document.createElement('div')
        el.className =
          'flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold text-white shadow-md'
        el.style.backgroundColor = colorFor(i)
        el.style.border = '3px solid #fff'
        el.textContent = '★'
        el.title = b.name
        markersRef.current.push(
          new mapboxgl.Marker({ element: el })
            .setLngLat([b.lng, b.lat])
            .setPopup(
              new mapboxgl.Popup({ offset: 18 }).setHTML(
                `<strong>${b.name}</strong><br/>${clusterRadiusMiles}mi cluster radius`
              )
            )
            .addTo(map)
        )
      })

      // Property dots. Bigger hit area + hover scale so the click
      // affordance is obvious.
      validAssignments.forEach((a) => {
        const el = document.createElement('div')
        el.className = 'rounded-full shadow transition-transform'
        el.style.width = '14px'
        el.style.height = '14px'
        el.style.backgroundColor = colorFor(a.assigned_branch_idx)
        el.style.border = a.overridden
          ? '2px solid #facc15'
          : a.transferred
            ? '2px solid #fff'
            : '1.5px solid rgba(0,0,0,0.3)'
        el.style.cursor = 'pointer'
        el.style.pointerEvents = 'auto'
        el.title = `${a.address}${a.is_remote ? ' (overnight — click to reassign)' : ' — click to reassign'}`
        el.addEventListener('mouseenter', () => {
          el.style.transform = 'scale(1.6)'
          el.style.zIndex = '10'
        })
        el.addEventListener('mouseleave', () => {
          el.style.transform = 'scale(1)'
          el.style.zIndex = ''
        })
        el.addEventListener('click', (e) => {
          e.stopPropagation()
          setSelected(a)
          mapRef.current?.flyTo({
            center: [a.lng, a.lat],
            zoom: Math.max(mapRef.current.getZoom(), 9),
            duration: 400,
          })
        })
        markersRef.current.push(
          new mapboxgl.Marker({ element: el }).setLngLat([a.lng, a.lat]).addTo(map)
        )
      })

      // Fit to all points if we have any.
      const pts: [number, number][] = []
      branches.forEach((b) => pts.push([b.lng, b.lat]))
      validAssignments.forEach((a) => pts.push([a.lng, a.lat]))
      if (pts.length > 1) {
        const bounds = pts.reduce(
          (b, p) => b.extend(p),
          new mapboxgl.LngLatBounds(pts[0], pts[0])
        )
        map.fitBounds(bounds, { padding: 60, maxZoom: 9, duration: 500 })
      }
    }

    if (map.loaded()) render()
    else map.once('load', render)
  }, [branches, validAssignments, clusterRadiusMiles])

  if (!mapboxgl.accessToken) {
    return (
      <div className="rounded-md border border-warning/30 bg-warning-subtle px-3 py-2 text-xs text-fg">
        Map disabled — set <code className="font-mono">VITE_MAPBOX_ACCESS_TOKEN</code> in env.
      </div>
    )
  }

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="rounded-md border border-border overflow-hidden"
        style={{ height: 600 }}
      />

      {/* Legend */}
      <div className="absolute top-3 left-3 rounded-md bg-surface/95 backdrop-blur border border-border px-3 py-2 text-xs space-y-1 max-w-xs">
        <p className="font-semibold text-fg">Branches</p>
        {branches.map((b, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: colorFor(i) }}
            />
            <span className="text-fg-muted truncate">{b.name}</span>
          </div>
        ))}
        <p className="text-[10px] text-fg-subtle pt-1 border-t border-border mt-2">
          <span className="font-semibold text-fg">Click any property dot</span> to
          reassign it to a different branch.<br />
          <span className="inline-block h-2.5 w-2.5 rounded-full mr-1" style={{ border: '2px solid #facc15' }} />{' '}
          = overridden
        </p>
      </div>

      {/* Override popup — top-right anchored, prominent so the operator
          sees that their click registered. Quick-pick branch buttons
          (one per branch) so reassignment is one click, not a dropdown
          interaction. */}
      {selected && (
        <div className="absolute top-3 right-3 w-80 rounded-md border-2 border-accent bg-surface shadow-2xl p-3 space-y-2 z-20">
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-fg-subtle font-semibold">
                Reassign property
              </p>
              <p className="text-sm font-semibold text-fg truncate">{selected.address}</p>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-fg-subtle hover:text-fg flex-shrink-0"
            >
              ✕
            </button>
          </div>
          <p className="text-xs text-fg-muted">
            Currently:{' '}
            <strong>{branches[selected.assigned_branch_idx]?.name ?? '?'}</strong>
            {selected.transferred && (
              <span className="ml-1 text-warning">
                (moved from {branches[selected.nearest_branch_idx]?.name})
              </span>
            )}
            {selected.overridden && (
              <span className="ml-1 text-accent">(overridden)</span>
            )}
          </p>
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
              Assign to:
            </p>
            <button
              type="button"
              disabled={saving || !selected.overridden}
              onClick={() => setOverride(selected.service_location_id, null)}
              className={
                'w-full text-left rounded-md border px-2 py-1.5 text-xs transition ' +
                (!selected.overridden
                  ? 'border-accent bg-accent/10 text-fg cursor-default'
                  : 'border-border hover:bg-surface-muted text-fg')
              }
            >
              <span className="font-semibold">Auto (engine)</span>
              <span className="ml-1 text-fg-subtle">
                — picks {branches[selected.nearest_branch_idx]?.name} (nearest)
              </span>
            </button>
            {branches.map((b, i) => {
              const overrideVal = overrides[selected.service_location_id]
              const active = overrideVal === i
              return (
                <button
                  key={i}
                  type="button"
                  disabled={saving || active}
                  onClick={() => setOverride(selected.service_location_id, i)}
                  className={
                    'w-full text-left rounded-md border px-2 py-1.5 text-xs transition flex items-center gap-2 ' +
                    (active
                      ? 'border-accent bg-accent/10 text-fg cursor-default'
                      : 'border-border hover:bg-surface-muted text-fg')
                  }
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: colorFor(i) }}
                  />
                  <span className="font-medium truncate">{b.name}</span>
                  {active && <span className="ml-auto text-accent text-[10px]">✓</span>}
                </button>
              )
            })}
          </div>
          {saving && (
            <p className="text-[11px] text-fg-muted italic">Saving…</p>
          )}
          {error && (
            <p className="text-[11px] text-danger">{error}</p>
          )}
          <p className="text-[10px] text-fg-subtle pt-1 border-t border-border">
            Regenerate the template for the override to affect the schedule.
          </p>
        </div>
      )}
    </div>
  )
}
