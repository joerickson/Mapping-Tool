import { useEffect, useRef, useCallback, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import Supercluster from 'supercluster'
import type { Property, ServiceLocation, MapFilter } from '../../types'
import { CATEGORY_COLORS } from '../../lib/constants'
import 'mapbox-gl/dist/mapbox-gl.css'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN ?? ''

interface MapPin {
  property: Property
  locations: ServiceLocation[]
}

interface MapViewProps {
  pins: MapPin[]
  onPinClick: (pin: MapPin) => void
  onBulkSelect?: (pins: MapPin[]) => void
  bulkSelectMode: boolean
  selectedIds: Set<string>
  filter: MapFilter
}

export default function MapView({
  pins,
  onPinClick,
  onBulkSelect,
  bulkSelectMode,
  selectedIds,
  filter,
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const clusterRef = useRef<Supercluster | null>(null)
  const [mapLoaded, setMapLoaded] = useState(false)

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-98.5795, 39.8283], // US center
      zoom: 4,
    })

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right')

    map.current.on('load', () => {
      setMapLoaded(true)
    })

    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [])

  // Build GeoJSON from pins and update cluster
  useEffect(() => {
    if (!mapLoaded || !map.current) return

    const geojsonFeatures: GeoJSON.Feature<GeoJSON.Point>[] = pins
      .filter((p) => p.property.latitude != null && p.property.longitude != null)
      .map((p) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [p.property.longitude!, p.property.latitude!],
        },
        properties: {
          property_id: p.property.property_id,
          rbm_category: p.property.rbm_category ?? 'default',
          selected: selectedIds.has(p.property.property_id),
          location_count: p.locations.length,
        },
      }))

    clusterRef.current = new Supercluster({
      radius: 60,
      maxZoom: 16,
    })
    clusterRef.current.load(geojsonFeatures as any)

    const m = map.current
    const sourceId = 'properties'

    if (m.getSource(sourceId)) {
      ;(m.getSource(sourceId) as mapboxgl.GeoJSONSource).setData({
        type: 'FeatureCollection',
        features: geojsonFeatures,
      })
    } else {
      m.addSource(sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: geojsonFeatures },
        cluster: true,
        clusterMaxZoom: 15,
        clusterRadius: 60,
      })

      // Cluster circles
      m.addLayer({
        id: 'clusters',
        type: 'circle',
        source: sourceId,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step', ['get', 'point_count'],
            '#93c5fd', 20, '#3b82f6', 100, '#1d4ed8',
          ],
          'circle-radius': [
            'step', ['get', 'point_count'],
            20, 20, 30, 100, 40,
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      })

      // Cluster count labels
      m.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: sourceId,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
          'text-size': 13,
        },
        paint: { 'text-color': '#ffffff' },
      })

      // Individual pins
      m.addLayer({
        id: 'unclustered-point',
        type: 'circle',
        source: sourceId,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': [
            'match',
            ['get', 'rbm_category'],
            ...Object.entries(CATEGORY_COLORS).flatMap(([k, v]) => [k, v]),
            CATEGORY_COLORS.default,
          ],
          'circle-radius': [
            'case',
            ['boolean', ['get', 'selected'], false],
            10,
            7,
          ],
          'circle-stroke-width': [
            'case',
            ['boolean', ['get', 'selected'], false],
            3,
            1.5,
          ],
          'circle-stroke-color': [
            'case',
            ['boolean', ['get', 'selected'], false],
            '#fbbf24',
            '#ffffff',
          ],
        },
      })

      // Click on cluster → zoom in
      m.on('click', 'clusters', (e) => {
        const features = m.queryRenderedFeatures(e.point, { layers: ['clusters'] })
        const clusterId = features[0]?.properties?.cluster_id
        ;(m.getSource(sourceId) as mapboxgl.GeoJSONSource).getClusterExpansionZoom(
          clusterId,
          (err, zoom) => {
            if (err) return
            m.easeTo({
              center: (features[0].geometry as GeoJSON.Point).coordinates as [number, number],
              zoom: zoom ?? 10,
            })
          }
        )
      })

      // Click on individual pin
      m.on('click', 'unclustered-point', (e) => {
        const feature = e.features?.[0]
        if (!feature) return
        const propertyId = feature.properties?.property_id
        const pin = pins.find((p) => p.property.property_id === propertyId)
        if (pin) onPinClick(pin)
      })

      m.on('mouseenter', 'clusters', () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'clusters', () => { m.getCanvas().style.cursor = '' })
      m.on('mouseenter', 'unclustered-point', () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'unclustered-point', () => { m.getCanvas().style.cursor = '' })
    }
  }, [mapLoaded, pins, selectedIds, onPinClick])

  return <div ref={mapContainer} className="w-full h-full" />
}
