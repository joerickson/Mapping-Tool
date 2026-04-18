import type { GeoJSONPolygon } from '../../types'

export interface ParcelResult {
  parcel_id?: string
  parcel_polygon?: GeoJSONPolygon
  building_sqft?: number
  lot_sqft?: number
  year_built?: number
  zoning_code?: string
  land_use_code?: string
  owner_name?: string
  owner_mailing_address?: string
}

export async function lookupParcel(
  lat: number,
  lng: number,
  apiKey: string
): Promise<ParcelResult | null> {
  const url = `https://app.regrid.com/api/v1/search?lat=${lat}&lon=${lng}&token=${apiKey}&return_geometry=true`
  const res = await fetch(url)
  if (!res.ok) return null

  const data = await res.json()
  const features = data?.features
  if (!features?.length) return null

  const feature = features[0]
  const props = feature.properties?.fields ?? {}

  return {
    parcel_id: props.parcelnumb ?? props.fips_parcel_id,
    parcel_polygon: feature.geometry?.type === 'Polygon' ? feature.geometry : undefined,
    building_sqft: props.sqft ? Number(props.sqft) : undefined,
    lot_sqft: props.lotareasqft ? Number(props.lotareasqft) : undefined,
    year_built: props.yearbuilt ? Number(props.yearbuilt) : undefined,
    zoning_code: props.zoning,
    land_use_code: props.usecode ?? props.landusecode,
    owner_name: props.owner,
    owner_mailing_address: [props.mailadd, props.mail_city, props.mail_state2, props.mail_zip]
      .filter(Boolean)
      .join(', ') || undefined,
  }
}
