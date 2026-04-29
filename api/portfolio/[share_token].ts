import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../_lib/supabase.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).end()

  const { share_token } = req.query
  const db = createAdminClient()

  const { data: portfolio, error } = await db
    .from('portfolios')
    .select('*')
    .eq('share_token', String(share_token))
    .maybeSingle()

  if (error || !portfolio) return res.status(404).send('<h1>Portfolio not found</h1>')

  if (portfolio.share_expires_at && new Date(portfolio.share_expires_at) < new Date()) {
    return res.status(410).send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><title>Link Expired</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb}
.card{background:#fff;border-radius:12px;padding:2rem 3rem;box-shadow:0 2px 12px rgba(0,0,0,.08);text-align:center;max-width:400px}
h1{color:#111827;margin:0 0 .5rem}p{color:#6b7280;margin:0}</style></head>
<body><div class="card"><h1>Link Expired</h1><p>This portfolio share link has expired. Please request a new link.</p></div></body>
</html>`)
  }

  // Fetch service locations and their properties
  const { data: members } = await db
    .from('portfolio_locations')
    .select('property_id')
    .eq('portfolio_id', portfolio.portfolio_id)

  const propIds = (members ?? []).map((m: any) => m.property_id)
  let properties: any[] = []

  if (propIds.length) {
    const { data: props } = await db
      .from('properties')
      .select('*, service_locations(*)')
      .in('id', propIds)
    properties = props ?? []
  }

  const serviceLocations = properties.flatMap((p: any) =>
    (p.service_locations ?? []).map((sl: any) => ({ ...sl, property: p }))
  )

  const totalSqft = serviceLocations.reduce(
    (sum: number, sl: any) => sum + (sl.serviceable_sqft ?? 0),
    0
  )
  const totalMCV = portfolio.show_financials
    ? serviceLocations.reduce((sum: number, sl: any) => sum + (sl.monthly_contract_value ?? 0), 0)
    : null

  const pins = properties
    .filter((p: any) => p.latitude && p.longitude)
    .map((p: any) => ({
      lat: p.latitude,
      lng: p.longitude,
      city: p.city,
      state: p.state,
      count: (p.service_locations ?? []).length,
    }))

  const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN ?? ''

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${portfolio.name} — RBM Geo</title>
  <link href="https://api.mapbox.com/mapbox-gl-js/v3.9.0/mapbox-gl.css" rel="stylesheet"/>
  <script src="https://api.mapbox.com/mapbox-gl-js/v3.9.0/mapbox-gl.js"></script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;color:#111827}
    header{background:#fff;border-bottom:1px solid #e5e7eb;padding:1rem 1.5rem;display:flex;align-items:center;gap:1rem}
    header h1{font-size:1.25rem;font-weight:600}
    .stats{display:flex;gap:1.5rem;margin-left:auto}
    .stat{text-align:center}
    .stat-val{font-weight:700;font-size:1.1rem}
    .stat-lbl{font-size:.75rem;color:#6b7280}
    #map{height:50vh}
    .locations{max-width:900px;margin:1.5rem auto;padding:0 1rem}
    .locations h2{font-size:1rem;font-weight:600;margin-bottom:.75rem}
    table{width:100%;border-collapse:collapse;font-size:.875rem}
    th{text-align:left;padding:.5rem .75rem;border-bottom:2px solid #e5e7eb;color:#6b7280;font-weight:500}
    td{padding:.5rem .75rem;border-bottom:1px solid #f3f4f6}
    tr:hover td{background:#f9fafb}
  </style>
</head>
<body>
  <header>
    <h1>${portfolio.name}</h1>
    <div class="stats">
      <div class="stat"><div class="stat-val">${serviceLocations.length}</div><div class="stat-lbl">Locations</div></div>
      <div class="stat"><div class="stat-val">${totalSqft.toLocaleString()}</div><div class="stat-lbl">Total Sq Ft</div></div>
      ${totalMCV !== null ? `<div class="stat"><div class="stat-val">$${totalMCV.toLocaleString()}</div><div class="stat-lbl">Monthly Value</div></div>` : ''}
    </div>
  </header>
  <div id="map"></div>
  <div class="locations">
    <h2>Service Locations</h2>
    <table>
      <thead><tr><th>Name</th><th>Address</th><th>City</th><th>State</th><th>Status</th>${portfolio.show_financials ? '<th>Monthly Value</th>' : ''}</tr></thead>
      <tbody>
        ${serviceLocations
          .map(
            (sl: any) => `<tr>
              <td>${sl.display_name ?? '—'}</td>
              <td>${sl.property?.address_line1 ?? '—'}</td>
              <td>${sl.property?.city ?? '—'}</td>
              <td>${sl.property?.state ?? '—'}</td>
              <td>${sl.status}</td>
              ${portfolio.show_financials ? `<td>${sl.monthly_contract_value ? '$' + Number(sl.monthly_contract_value).toLocaleString() : '—'}</td>` : ''}
            </tr>`
          )
          .join('')}
      </tbody>
    </table>
  </div>
  <script>
    mapboxgl.accessToken = ${JSON.stringify(mapboxToken)};
    const pins = ${JSON.stringify(pins)};
    const map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/streets-v12',
      center: pins.length ? [pins[0].lng, pins[0].lat] : [-98.5, 39.5],
      zoom: 5,
    });
    map.on('load', () => {
      if (!pins.length) return;
      const bounds = new mapboxgl.LngLatBounds();
      pins.forEach(p => {
        bounds.extend([p.lng, p.lat]);
        new mapboxgl.Marker({ color: '#2563eb' })
          .setLngLat([p.lng, p.lat])
          .setPopup(new mapboxgl.Popup({ offset: 25 }).setHTML('<strong>' + p.city + ', ' + p.state + '</strong><br/>' + p.count + ' location(s)'))
          .addTo(map);
      });
      if (pins.length > 1) map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
    });
  </script>
</body>
</html>`

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).send(html)
}
