import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../_lib/supabase.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).end()

  const { token, service_location_ids, property_ids, portfolio_id } = req.query

  const db = createAdminClient()

  // Verify embed token
  if (!token) return res.status(401).send('<h1>Access denied</h1>')

  const { data: tokenRecord } = await db
    .from('embed_tokens')
    .select('scope, expires_at')
    .eq('token', String(token))
    .maybeSingle()

  if (!tokenRecord) return res.status(401).send('<h1>Invalid embed token</h1>')
  if (new Date(tokenRecord.expires_at) < new Date()) {
    return res.status(401).send('<h1>Embed token has expired</h1>')
  }

  // Resolve pins from query params (or fall back to token scope)
  const scope = tokenRecord.scope as any
  const resolvedSlIds: string[] = service_location_ids
    ? String(service_location_ids).split(',').filter(Boolean)
    : scope.service_location_ids ?? []
  const resolvedPropIds: string[] = property_ids
    ? String(property_ids).split(',').filter(Boolean)
    : scope.property_ids ?? []
  const resolvedPortfolioId: string | null =
    portfolio_id ? String(portfolio_id) : scope.portfolio_id ?? null

  // Collect property_ids from all sources
  const allPropIds = new Set<string>(resolvedPropIds)

  if (resolvedSlIds.length) {
    const { data: sls } = await db
      .from('service_locations')
      .select('property_id, display_name')
      .in('id', resolvedSlIds)
    for (const sl of sls ?? []) allPropIds.add(sl.property_id)
  }

  if (resolvedPortfolioId) {
    const { data: members } = await db
      .from('portfolio_locations')
      .select('property_id')
      .eq('portfolio_id', resolvedPortfolioId)
    for (const m of members ?? []) allPropIds.add(m.property_id)
  }

  // Fetch locations with lat/lng
  type Pin = { service_location_id: string; display_name: string; lat: number; lng: number; city: string }
  const pins: Pin[] = []

  if (allPropIds.size) {
    const { data: props } = await db
      .from('properties')
      .select('id, latitude, longitude, city, service_locations(id, display_name)')
      .in('id', [...allPropIds])
      .not('latitude', 'is', null)

    for (const p of (props ?? []) as any[]) {
      for (const sl of (p.service_locations ?? []) as any[]) {
        pins.push({
          service_location_id: sl.id,
          display_name: sl.display_name ?? p.city,
          lat: p.latitude,
          lng: p.longitude,
          city: p.city,
        })
      }
    }
  }

  const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN ?? ''
  const pinsJson = JSON.stringify(pins)

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PortfolioIQ Map</title>
  <link href="https://api.mapbox.com/mapbox-gl-js/v3.9.0/mapbox-gl.css" rel="stylesheet" />
  <script src="https://api.mapbox.com/mapbox-gl-js/v3.9.0/mapbox-gl.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #map { width: 100%; height: 100%; }
    .popup { font-family: sans-serif; font-size: 13px; }
    .popup strong { display: block; margin-bottom: 2px; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    mapboxgl.accessToken = ${JSON.stringify(mapboxToken)};
    const pins = ${pinsJson};

    const map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/streets-v12',
      center: pins.length ? [pins[0].lng, pins[0].lat] : [-98.5, 39.5],
      zoom: pins.length === 1 ? 14 : 5,
    });

    map.on('load', () => {
      if (!pins.length) return;

      const bounds = new mapboxgl.LngLatBounds();
      pins.forEach(pin => {
        bounds.extend([pin.lng, pin.lat]);
        new mapboxgl.Marker({ color: '#2563eb' })
          .setLngLat([pin.lng, pin.lat])
          .setPopup(
            new mapboxgl.Popup({ offset: 25 }).setHTML(
              '<div class="popup"><strong>' + pin.display_name + '</strong>' + pin.city + '</div>'
            )
          )
          .addTo(map);
      });

      if (pins.length > 1) {
        map.fitBounds(bounds, { padding: 60, maxZoom: 15 });
      }
    });
  </script>
</body>
</html>`

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Content-Security-Policy',
    "frame-ancestors 'self' https://*.rbmservicesinc.com; default-src 'self' https://api.mapbox.com https://events.mapbox.com; script-src 'self' 'unsafe-inline' https://api.mapbox.com; style-src 'self' 'unsafe-inline' https://api.mapbox.com; img-src * blob: data:; worker-src blob:; connect-src https://api.mapbox.com https://events.mapbox.com;"
  )
  res.setHeader('X-Frame-Options', 'ALLOW-FROM https://*.rbmservicesinc.com')
  return res.status(200).send(html)
}
