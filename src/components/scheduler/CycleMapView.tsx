// Phase 4f-3 — Cycle map view.
//
// Spatial reasoning. Full-bleed Mapbox map showing branches + properties
// + the routes for the day under the time scrubber. Right-side panel
// summarizes per-crew status for the current date. Drag scrubber to
// step through the cycle; play-animation + layer toggles deferred.
import { useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { stateClass, type CrewDayStateKind } from './CrewUtilizationChip'
import { cn } from '../../lib/cn'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN ?? ''

const CREW_COLORS = [
  '#6366f1', // indigo
  '#14b8a6', // teal
  '#f59e0b', // amber
  '#f43f5e', // rose
  '#10b981', // emerald
  '#8b5cf6', // violet
  '#64748b', // slate
]

interface Visit {
  id: string
  service_location_id: string
  scheduled_date: string | null
  arrival_time: string | null
  departure_time: string | null
  hours_per_visit_total: number | null
  status: string
  crew_day_route_id: string | null
  service_locations?: {
    display_name: string | null
    property: { address_line1: string; latitude: number | null; longitude: number | null } | null
  } | null
}

interface CrewDay {
  id: string
  trip_id: string
  trip_label: string | null
  crew_index: number
  scheduled_date: string
  day_type: string
  start_location: { type?: string; name?: string; lat?: number; lng?: number } | null
  total_drive_minutes: number | null
  total_work_minutes: number | null
  total_drive_miles: number | null
}

interface UtilDay {
  crew_index: number
  crew_label: string
  scheduled_date: string
  state: { kind: CrewDayStateKind; work_hours: number; unused_hours: number }
  utilization_pct: number
}

interface Branch { name: string; lat: number; lng: number }

interface Props {
  visits: Visit[]
  crewDays: CrewDay[]
  utilDays: UtilDay[]
  branches: Branch[]
  cycleStart: string
  cycleEnd: string
  height?: number
}

export default function CycleMapView({
  visits,
  crewDays,
  utilDays,
  branches,
  cycleStart,
  cycleEnd,
  height = 600,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])
  const [mapLoaded, setMapLoaded] = useState(false)

  // All distinct dates in the cycle (workdays only).
  const dates = useMemo(() => {
    const set = new Set<string>()
    for (const u of utilDays) set.add(u.scheduled_date)
    return Array.from(set).sort()
  }, [utilDays])

  const [scrubIdx, setScrubIdx] = useState(0)
  // Reset scrub if dates list shortens past the current index.
  useEffect(() => {
    if (scrubIdx >= dates.length) setScrubIdx(Math.max(0, dates.length - 1))
  }, [dates, scrubIdx])

  const currentDate = dates[scrubIdx] ?? cycleStart

  // Crew-day routes for the current date, indexed by crew_index.
  const dayCrewDays = useMemo(() => {
    const out = new Map<number, CrewDay>()
    for (const cd of crewDays) {
      if (cd.scheduled_date === currentDate) out.set(cd.crew_index, cd)
    }
    return out
  }, [crewDays, currentDate])

  // Visits for the current date, grouped by crew_index.
  const dayVisitsByCrewIndex = useMemo(() => {
    const crewByRoute = new Map<string, number>()
    for (const cd of crewDays) crewByRoute.set(cd.id, cd.crew_index)
    const out = new Map<number, Visit[]>()
    for (const v of visits) {
      if (v.scheduled_date !== currentDate) continue
      if (!v.crew_day_route_id) continue
      const ci = crewByRoute.get(v.crew_day_route_id)
      if (ci == null) continue
      const arr = out.get(ci) ?? []
      arr.push(v)
      out.set(ci, arr)
    }
    for (const arr of out.values()) {
      arr.sort((a, b) => (a.arrival_time ?? '').localeCompare(b.arrival_time ?? ''))
    }
    return out
  }, [visits, crewDays, currentDate])

  // Utilization snapshot per crew for the current day, indexed by crew_index.
  const dayUtilByCrewIndex = useMemo(() => {
    const out = new Map<number, UtilDay>()
    for (const u of utilDays) {
      if (u.scheduled_date === currentDate) out.set(u.crew_index, u)
    }
    return out
  }, [utilDays, currentDate])

  // Map init + cleanup.
  useEffect(() => {
    if (!containerRef.current || !mapboxgl.accessToken) return
    if (mapRef.current) return
    // Center on the centroid of branches if present, else US center.
    let centerLng = -98.5
    let centerLat = 39.8
    if (branches.length > 0) {
      centerLng = branches.reduce((s, b) => s + b.lng, 0) / branches.length
      centerLat = branches.reduce((s, b) => s + b.lat, 0) / branches.length
    }
    const m = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [centerLng, centerLat],
      zoom: 5,
    })
    mapRef.current = m
    m.on('load', () => setMapLoaded(true))
    return () => {
      markersRef.current.forEach((mk) => mk.remove())
      markersRef.current = []
      m.remove()
      mapRef.current = null
      setMapLoaded(false)
    }
  }, [branches])

  // Render branches once.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return
    const m = mapRef.current
    const branchEls: mapboxgl.Marker[] = []
    for (const b of branches) {
      const el = document.createElement('div')
      el.className =
        'flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-md'
      el.style.backgroundColor = '#0f172a'
      el.style.border = '2px solid #fff'
      el.textContent = '★'
      el.title = b.name
      branchEls.push(
        new mapboxgl.Marker({ element: el })
          .setLngLat([b.lng, b.lat])
          .setPopup(new mapboxgl.Popup({ offset: 18 }).setHTML(`<strong>${b.name}</strong><br/>Branch`))
          .addTo(m)
      )
    }
    return () => {
      branchEls.forEach((mk) => mk.remove())
    }
  }, [mapLoaded, branches])

  // Render visit markers + route polylines for the current scrub date.
  // Re-runs whenever currentDate or visit data changes.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return
    const m = mapRef.current

    // Clear previous markers
    markersRef.current.forEach((mk) => mk.remove())
    markersRef.current = []

    const allCoords: [number, number][] = branches.map((b) => [b.lng, b.lat])

    for (const [crewIdx, crewVisits] of dayVisitsByCrewIndex) {
      const color = CREW_COLORS[crewIdx % CREW_COLORS.length]
      const stops: [number, number][] = []
      for (const v of crewVisits) {
        const lat = v.service_locations?.property?.latitude
        const lng = v.service_locations?.property?.longitude
        if (lat == null || lng == null) continue
        const el = document.createElement('div')
        el.className =
          'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white shadow'
        el.style.backgroundColor = color
        el.style.border = '2px solid #fff'
        el.textContent = String(crewVisits.indexOf(v) + 1)
        markersRef.current.push(
          new mapboxgl.Marker({ element: el })
            .setLngLat([lng, lat])
            .setPopup(
              new mapboxgl.Popup({ offset: 14 }).setHTML(
                `<strong>Stop ${crewVisits.indexOf(v) + 1}</strong><br/>${
                  v.service_locations?.property?.address_line1 ?? ''
                }<br/>${v.arrival_time ?? ''}–${v.departure_time ?? ''}`
              )
            )
            .addTo(m)
        )
        stops.push([lng, lat])
        allCoords.push([lng, lat])
      }

      // Route polyline: branch (or trip start) → stops → branch.
      const cd = dayCrewDays.get(crewIdx)
      const startBranch = branches.find((b) => b.name === cd?.start_location?.name)
      const startCoord: [number, number] | null = startBranch
        ? [startBranch.lng, startBranch.lat]
        : cd?.start_location?.lat != null && cd?.start_location?.lng != null
          ? [cd.start_location.lng, cd.start_location.lat]
          : null
      const lineCoords: [number, number][] = []
      if (startCoord) lineCoords.push(startCoord)
      lineCoords.push(...stops)
      if (startCoord && cd?.day_type !== 'overnight') lineCoords.push(startCoord)

      const sourceId = `route-${crewIdx}`
      if (m.getLayer(sourceId)) m.removeLayer(sourceId)
      if (m.getSource(sourceId)) m.removeSource(sourceId)
      if (lineCoords.length >= 2) {
        m.addSource(sourceId, {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: lineCoords } },
        })
        m.addLayer({
          id: sourceId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': color,
            'line-width': 3,
            'line-opacity': 0.7,
            'line-dasharray': cd?.day_type === 'travel' ? [2, 2] : [1, 0],
          },
        })
      }
    }

    // Fit bounds when day data changes — but only if there are actual coords.
    if (allCoords.length > 1) {
      const bounds = allCoords.reduce(
        (b, c) => b.extend(c),
        new mapboxgl.LngLatBounds(allCoords[0], allCoords[0])
      )
      m.fitBounds(bounds, { padding: 40, maxZoom: 11, duration: 300 })
    }

    // Cleanup polylines on unmount of this effect — clear all crew route layers.
    return () => {
      for (const [crewIdx] of dayVisitsByCrewIndex) {
        const sourceId = `route-${crewIdx}`
        if (m.getLayer(sourceId)) m.removeLayer(sourceId)
        if (m.getSource(sourceId)) m.removeSource(sourceId)
      }
    }
  }, [mapLoaded, branches, dayVisitsByCrewIndex, dayCrewDays])

  if (dates.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface p-6 text-sm text-fg-muted">
        No scheduled days yet. Generate a cycle first.
      </div>
    )
  }
  if (!mapboxgl.accessToken) {
    return (
      <div className="rounded-md border border-warning/40 bg-warning/5 p-6 text-sm text-fg">
        VITE_MAPBOX_ACCESS_TOKEN not set — Map view requires a Mapbox token.
      </div>
    )
  }

  const currentDateObj = new Date(currentDate + 'T00:00:00Z')
  const dayLabel = currentDateObj.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })

  return (
    <div className="rounded-md border border-border bg-surface overflow-hidden flex flex-col">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px]" style={{ height }}>
        <div ref={containerRef} className="bg-surface-subtle" />

        {/* Right-side crew status panel */}
        <aside className="border-l border-border bg-surface overflow-y-auto">
          <header className="px-3 py-2 border-b border-border bg-surface-subtle">
            <p className="text-sm font-semibold text-fg">{dayLabel}</p>
            <p className="text-[11px] text-fg-muted font-tabular">
              Day {scrubIdx + 1} of {dates.length}
            </p>
          </header>
          <ul className="divide-y divide-border">
            {Array.from(dayUtilByCrewIndex.entries())
              .sort(([a], [b]) => a - b)
              .map(([crewIdx, util]) => {
                const cd = dayCrewDays.get(crewIdx)
                const stops = (dayVisitsByCrewIndex.get(crewIdx) ?? []).length
                return (
                  <li key={crewIdx} className="px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: CREW_COLORS[crewIdx % CREW_COLORS.length] }}
                      />
                      <span className="font-medium text-fg">{util.crew_label}</span>
                      <span
                        className={cn(
                          'ml-auto rounded border px-1.5 py-0.5 font-mono text-[10px]',
                          stateClass(util.state.kind)
                        )}
                      >
                        {util.state.kind}
                      </span>
                    </div>
                    <p className="mt-1 text-fg-muted font-tabular">
                      {util.state.kind === 'idle' || util.state.kind === 'between_trips' ? (
                        <span className="text-danger">No work scheduled</span>
                      ) : (
                        <>
                          {stops} stop{stops === 1 ? '' : 's'} · {util.state.work_hours.toFixed(1)}h
                          {cd?.total_drive_miles != null && (
                            <> · {Math.round(Number(cd.total_drive_miles))} mi</>
                          )}
                        </>
                      )}
                    </p>
                    {cd?.trip_label && (
                      <p className="text-[10px] text-fg-subtle">{cd.trip_label}</p>
                    )}
                  </li>
                )
              })}
          </ul>
        </aside>
      </div>

      {/* Time scrubber */}
      <div className="border-t border-border bg-surface-subtle px-4 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setScrubIdx((i) => Math.max(0, i - 1))}
          disabled={scrubIdx === 0}
          className="rounded border border-border bg-surface px-2 py-1 text-xs disabled:opacity-50"
        >
          ←
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, dates.length - 1)}
          value={scrubIdx}
          onChange={(e) => setScrubIdx(Number(e.target.value))}
          className="flex-1 accent-accent"
        />
        <button
          type="button"
          onClick={() => setScrubIdx((i) => Math.min(dates.length - 1, i + 1))}
          disabled={scrubIdx === dates.length - 1}
          className="rounded border border-border bg-surface px-2 py-1 text-xs disabled:opacity-50"
        >
          →
        </button>
        <span className="text-xs text-fg-muted font-tabular whitespace-nowrap min-w-[120px] text-right">
          {currentDate}
        </span>
      </div>
    </div>
  )
}
