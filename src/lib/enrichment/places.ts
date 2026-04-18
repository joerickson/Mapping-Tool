export interface PlacesResult {
  google_place_id: string
  place_name: string
  place_types: string[]
  place_website?: string
  place_phone?: string
}

export async function enrichWithPlaces(
  lat: number,
  lng: number,
  apiKey: string
): Promise<PlacesResult | null> {
  // Nearby search
  const nearbyUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=30&key=${apiKey}`
  const nearbyRes = await fetch(nearbyUrl)
  if (!nearbyRes.ok) return null

  const nearbyData = await nearbyRes.json()
  if (nearbyData.status !== 'OK' || !nearbyData.results?.length) return null

  // Pick closest result
  const place = nearbyData.results[0]
  const placeId = place.place_id

  // Place Details
  const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,types,website,formatted_phone_number&key=${apiKey}`
  const detailsRes = await fetch(detailsUrl)
  if (!detailsRes.ok) return null

  const detailsData = await detailsRes.json()
  if (detailsData.status !== 'OK') return null

  const details = detailsData.result

  return {
    google_place_id: placeId,
    place_name: details.name ?? place.name,
    place_types: details.types ?? place.types ?? [],
    place_website: details.website,
    place_phone: details.formatted_phone_number,
  }
}
