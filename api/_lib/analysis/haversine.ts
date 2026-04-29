// Great-circle distance helpers. Earth radius in miles.
const EARTH_RADIUS_MI = 3958.7613

export interface LatLng {
  lat: number
  lng: number
}

export function haversineMiles(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
  return EARTH_RADIUS_MI * c
}

export function driveTimeMinutes(distanceMiles: number, speedMph: number): number {
  if (speedMph <= 0) return 0
  return (distanceMiles / speedMph) * 60
}

export function centroid(points: LatLng[]): LatLng {
  if (points.length === 0) return { lat: 0, lng: 0 }
  let sumLat = 0
  let sumLng = 0
  for (const p of points) {
    sumLat += p.lat
    sumLng += p.lng
  }
  return { lat: sumLat / points.length, lng: sumLng / points.length }
}
