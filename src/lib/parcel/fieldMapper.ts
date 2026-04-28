export interface RegridRawFields {
  ll_uuid?: string
  parcelnumb?: string
  usecode?: string
  usedesc?: string
  zoning?: string
  gisacre?: number | string
  ll_bldg_footprint_sqft?: number | string
  sqft?: number | string
  lotareasqft?: number | string
  yearbuilt?: number | string
  owner?: string
  mailadd?: string
  mail_city?: string
  mail_state2?: string
  mail_zip?: string
  [key: string]: unknown
}

export interface MappedParcelFields {
  regrid_ll_uuid?: string
  parcel_number?: string
  zoning_code?: string
  land_use_code?: string
  land_use_standardized?: string
  building_sqft?: number
  lot_sqft?: number
  year_built?: number
  owner_name?: string
  owner_mailing_address?: string
}

function toNum(v: unknown): number | undefined {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return isFinite(n) ? n : undefined
}

export function mapRegridFields(raw: RegridRawFields): MappedParcelFields {
  const buildingArea = toNum(raw.ll_bldg_footprint_sqft ?? raw.sqft)
  const lotArea =
    toNum(raw.lotareasqft) ??
    (toNum(raw.gisacre) != null ? Math.round(toNum(raw.gisacre)! * 43560) : undefined)

  const mailParts = [raw.mailadd, raw.mail_city, raw.mail_state2, raw.mail_zip]
    .filter(Boolean)
    .join(', ')

  return {
    regrid_ll_uuid: raw.ll_uuid ? String(raw.ll_uuid) : undefined,
    parcel_number: raw.parcelnumb ? String(raw.parcelnumb) : undefined,
    zoning_code: raw.zoning ? String(raw.zoning) : undefined,
    land_use_code: raw.usecode ? String(raw.usecode) : undefined,
    land_use_standardized: raw.usedesc ? String(raw.usedesc) : undefined,
    building_sqft: buildingArea != null ? Math.round(buildingArea) : undefined,
    lot_sqft: lotArea != null ? Math.round(lotArea) : undefined,
    year_built: toNum(raw.yearbuilt) != null ? Math.round(toNum(raw.yearbuilt)!) : undefined,
    owner_name: raw.owner ? String(raw.owner) : undefined,
    owner_mailing_address: mailParts || undefined,
  }
}
